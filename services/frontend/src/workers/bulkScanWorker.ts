/**
 * Bulk-upload EXIF scan worker
 *
 * Runs in a Web Worker so reading EXIF on thousands of files does not
 * lock the UI. The main thread posts a list of File objects, the
 * worker reads DateTimeOriginal and BodySerialNumber from every file
 * (only the EXIF block, not the pixels), and posts progress and a
 * final summary back.
 *
 * exifr supports a fast "pickTags" mode that streams just the few
 * tags we need from the first ~64 KB of the file. Even on a slow
 * laptop this is ~5 ms per file, so 5000 files = roughly 25 s.
 */
import exifr from 'exifr';

export interface ScanEntry {
  index: number;
  name: string;
  // The browser's webkitRelativePath includes the top folder, so
  // "FolderName/sub/IMG_0001.JPG". Stable across sessions for the same
  // folder, which matters for resume: we sort by this to give every
  // upload a deterministic position in the staging key.
  relative_path: string;
  size: number;
  captured_at: string | null;
  serial: string | null;
  // SHA-256 of the full file. Only filled in for status='valid' so we
  // don't pay the hashing cost on rejects. Sent to the API to ask
  // "which of these already exist?" before the user commits to upload.
  content_hash: string | null;
  status: 'valid' | 'missing_exif_datetime' | 'corrupt';
}

export interface ScanProgress {
  type: 'progress';
  done: number;
  total: number;
}

export interface ScanDone {
  type: 'done';
  entries: ScanEntry[];
}

export type ScanResult = ScanProgress | ScanDone;

interface ScanRequest {
  files: File[];
}

const PROGRESS_EVERY = 10;
// exifr can hang indefinitely on some malformed or oversized images.
// Race every parse against a wall-clock timeout so a single bad file
// can't freeze the whole scan. 5 s is more than enough for the EXIF
// header on any normal camera-trap JPEG; we already slice to the
// first ~256 KB so the read itself is bounded too.
const PER_FILE_TIMEOUT_MS = 5000;
const HEAD_BYTES = 256 * 1024;

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { files } = event.data;
  const entries: ScanEntry[] = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const file = files[i];
    const entry = await scanOne(i, file);
    entries.push(entry);
    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === total) {
      const progress: ScanProgress = { type: 'progress', done: i + 1, total };
      (self as unknown as Worker).postMessage(progress);
    }
  }

  const result: ScanDone = { type: 'done', entries };
  (self as unknown as Worker).postMessage(result);
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(null);
      });
  });
}

async function scanOne(index: number, file: File): Promise<ScanEntry> {
  const relPath =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const base: ScanEntry = {
    index,
    name: file.name,
    relative_path: relPath,
    size: file.size,
    captured_at: null,
    serial: null,
    content_hash: null,
    status: 'corrupt',
  };
  try {
    // Read only the first chunk so exifr does not pull a 30 MB photo
    // into worker memory just to look at the EXIF block. The block
    // lives in the first few KB of any standard JPEG.
    const head = file.slice(0, HEAD_BYTES);
    const meta = (await withTimeout(
      exifr.parse(head as Blob),
      PER_FILE_TIMEOUT_MS,
    )) as
      | {
          DateTimeOriginal?: Date | string;
          BodySerialNumber?: string | number;
          SerialNumber?: string | number;
        }
      | null;
    if (!meta || !meta.DateTimeOriginal) {
      return { ...base, status: 'missing_exif_datetime' };
    }
    const dt = parseExifDate(meta.DateTimeOriginal);
    if (!dt) {
      return { ...base, status: 'missing_exif_datetime' };
    }
    const rawSerial = meta.BodySerialNumber ?? meta.SerialNumber ?? null;
    const serial =
      rawSerial !== null && rawSerial !== undefined ? String(rawSerial).trim() : null;

    // SHA-256 of the full file matches the server-side dedup key
    // (services/bulk-upload/worker.py uses the same hash). We only pay
    // this cost on entries that survived the EXIF check, since
    // anything else is going to be skipped anyway.
    const hash = await withTimeout(hashFile(file), PER_FILE_TIMEOUT_MS);

    return {
      ...base,
      status: 'valid',
      captured_at: dt.toISOString(),
      serial: serial && serial.length > 0 ? serial : null,
      content_hash: hash,
    };
  } catch {
    return base;
  }
}

async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  const out = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return out.join('');
}

function parseExifDate(value: Date | string): Date | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  // exifr usually returns Date already, but in some edge cases a raw
  // EXIF string slips through. Parse the canonical "YYYY:MM:DD HH:MM:SS".
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  return isNaN(dt.getTime()) ? null : dt;
}
