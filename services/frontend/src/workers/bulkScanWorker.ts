/**
 * Bulk-upload EXIF scan worker
 *
 * Runs in a Web Worker so reading EXIF on thousands of files does not
 * lock the UI. The main thread posts a list of File objects, the
 * worker reads DateTimeOriginal and BodySerialNumber from each file
 * (only the first 256 KB, the EXIF block), and posts progress plus a
 * final summary back.
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
  // Naive ISO 8601 datetime ("YYYY-MM-DDTHH:MM:SS"), no TZ marker.
  // Matches the camera-clock convention in DEVELOPERS.md so the
  // pre-flight duplicate check can compare directly against
  // Image.captured_at without timezone shifting.
  captured_at: string | null;
  serial: string | null;
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

const PROGRESS_EVERY = 25;
// exifr can hang indefinitely on some malformed or oversized images.
// Race every parse against a wall-clock timeout so a single bad file
// can't freeze the whole scan. 2 s is plenty for a 256 KB head read
// on any normal camera-trap JPEG.
const PER_FILE_TIMEOUT_MS = 2000;
const HEAD_BYTES = 256 * 1024;
// EXIF reads are cheap. We still parallelize because file.slice() +
// arrayBuffer() does real IO and overlapping several reads keeps the
// pipeline full. 8 is a safe upper bound: most browsers cap IO
// concurrency around this anyway, and memory stays trivial
// (8 x 256 KB = 2 MB peak).
const SCAN_CONCURRENCY = 8;

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { files } = event.data;
  const total = files.length;
  const entries: ScanEntry[] = new Array(total);
  let nextIndex = 0;
  let completed = 0;

  const post = (done: number) => {
    const progress: ScanProgress = { type: 'progress', done, total };
    (self as unknown as Worker).postMessage(progress);
  };

  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      entries[i] = await scanOne(i, files[i]);
      completed += 1;
      if (completed % PROGRESS_EVERY === 0 || completed === total) {
        post(completed);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, total) }, () => worker()),
  );

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
    status: 'corrupt',
  };
  try {
    const head = await file.slice(0, HEAD_BYTES).arrayBuffer();
    const meta = (await withTimeout(
      exifr.parse(head),
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
    const naive = parseExifDateNaive(meta.DateTimeOriginal);
    if (!naive) {
      return { ...base, status: 'missing_exif_datetime' };
    }
    const rawSerial = meta.BodySerialNumber ?? meta.SerialNumber ?? null;
    const serial =
      rawSerial !== null && rawSerial !== undefined ? String(rawSerial).trim() : null;
    return {
      ...base,
      status: 'valid',
      captured_at: naive,
      serial: serial && serial.length > 0 ? serial : null,
    };
  } catch {
    return base;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseExifDateNaive(value: Date | string): string | null {
  // Emit a naive ISO 8601 string with no timezone marker, matching the
  // camera-clock convention in DEVELOPERS.md. Going through Date and
  // toISOString shifts to UTC, which is the wrong frame and would
  // break the pre-flight comparison against Image.captured_at.
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return (
      `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
      + `T${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`
    );
  }
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}
