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

const PICK_TAGS = ['DateTimeOriginal', 'BodySerialNumber', 'SerialNumber'] as const;
const PROGRESS_EVERY = 50;

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
    const meta = (await exifr.parse(file, { pick: PICK_TAGS as unknown as string[] })) as
      | {
          DateTimeOriginal?: Date | string;
          BodySerialNumber?: string | number;
          SerialNumber?: string | number;
        }
      | undefined;
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
    return {
      ...base,
      status: 'valid',
      captured_at: dt.toISOString(),
      serial: serial && serial.length > 0 ? serial : null,
    };
  } catch {
    return base;
  }
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
