/**
 * Bulk-upload EXIF scan worker
 *
 * Runs in a Web Worker so reading EXIF on thousands of files does not
 * lock the UI. The main thread posts the File objects with their paths
 * in the folder, the worker reads DateTimeOriginal, the serial and the
 * GPS position from each file (only the first 256 KB, the EXIF block),
 * and posts progress plus a final summary back.
 *
 * Two passes. The first reads 8 files at a time with a short limit. A slow
 * card reader makes reads fail or time out there (pwn: 929 of 2164 good
 * files), so every file that failed is read again, one at a time, with a
 * long limit. Only a file that fails twice is called corrupt.
 */
import exifr from 'exifr';

export interface ScanEntry {
  index: number;
  name: string;
  // Path in the picked folder, "FolderName/sub/IMG_0001.JPG". Unique per
  // file and stable across sessions for the same folder: the upload sorts
  // by it to give every file its index, and the duplicate check names
  // files by it.
  relative_path: string;
  size: number;
  // Naive ISO 8601 datetime ("YYYY-MM-DDTHH:MM:SS"), no TZ marker.
  // Matches the camera-clock convention in DEVELOPERS.md so the
  // pre-flight duplicate check can compare directly against
  // Image.captured_at without timezone shifting.
  captured_at: string | null;
  serial: string | null;
  // EXIF Make/Model, read so the server pre-flight can run the same camera
  // -profile hunt as live ingestion. Null when absent or unreadable.
  make: string | null;
  model: string | null;
  // A usable GPS position, by the same rule as the server's is_valid_gps.
  has_gps: boolean;
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
  // One per file. A File sent to a worker loses everything but its
  // contents and name, so the page sends the paths alongside.
  paths: string[];
}

const PROGRESS_EVERY = 25;
// exifr can hang indefinitely on some malformed or oversized images.
// Race every parse against a wall-clock timeout so a single bad file
// can't freeze the whole scan. 2 s is plenty for a 256 KB head read
// on any normal camera-trap JPEG.
const FIRST_PASS_TIMEOUT_MS = 2000;
const SECOND_PASS_TIMEOUT_MS = 10000;
const HEAD_BYTES = 256 * 1024;
// EXIF reads are cheap. We still parallelize because file.slice() +
// arrayBuffer() does real IO and overlapping several reads keeps the
// pipeline full. 8 is a safe upper bound: most browsers cap IO
// concurrency around this anyway, and memory stays trivial
// (8 x 256 KB = 2 MB peak).
const SCAN_CONCURRENCY = 8;

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { files, paths } = event.data;
  const total = files.length;
  const entries: ScanEntry[] = new Array(total);
  let nextIndex = 0;
  let completed = 0;

  const post = (done: number) => {
    const progress: ScanProgress = { type: 'progress', done, total };
    (self as unknown as Worker).postMessage(progress);
  };

  const finish = () => {
    completed += 1;
    if (completed % PROGRESS_EVERY === 0 || completed === total) post(completed);
  };

  // First pass. A failed file is not counted yet, so the bar only reaches
  // 100 % once the second pass is done.
  const retry: number[] = [];
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      entries[i] = await scanOne(i, files[i], paths[i], FIRST_PASS_TIMEOUT_MS);
      if (entries[i].status === 'corrupt') retry.push(i);
      else finish();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, total) }, () => worker()),
  );

  // Second pass, one file at a time.
  for (const i of retry) {
    entries[i] = await scanOne(i, files[i], paths[i], SECOND_PASS_TIMEOUT_MS);
    finish();
  }

  const result: ScanDone = { type: 'done', entries };
  (self as unknown as Worker).postMessage(result);
};

const TIMED_OUT = Symbol('timed out');

// Null when the parse fails (no usable metadata), TIMED_OUT when it takes
// too long (the file may be fine, the read was slow).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null | typeof TIMED_OUT> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(TIMED_OUT);
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

async function scanOne(
  index: number, file: File, path: string, timeoutMs: number,
): Promise<ScanEntry> {
  const base: ScanEntry = {
    index,
    name: file.name,
    relative_path: path,
    size: file.size,
    captured_at: null,
    serial: null,
    make: null,
    model: null,
    has_gps: false,
    status: 'corrupt',
  };
  try {
    const head = await file.slice(0, HEAD_BYTES).arrayBuffer();
    const result = await withTimeout(exifr.parse(head), timeoutMs);
    if (result === TIMED_OUT) return base;
    const meta = result as
      | {
          DateTimeOriginal?: Date | string;
          BodySerialNumber?: string | number;
          SerialNumber?: string | number;
          Make?: string;
          Model?: string;
          latitude?: number;
          longitude?: number;
        }
      | null;
    const make = meta?.Make ? String(meta.Make).trim() || null : null;
    const model = meta?.Model ? String(meta.Model).trim() || null : null;
    if (!meta || !meta.DateTimeOriginal) {
      return { ...base, make, model, status: 'missing_exif_datetime' };
    }
    const naive = parseExifDateNaive(meta.DateTimeOriginal);
    if (!naive) {
      return { ...base, make, model, status: 'missing_exif_datetime' };
    }
    const rawSerial = meta.BodySerialNumber ?? meta.SerialNumber ?? null;
    const serial =
      rawSerial !== null && rawSerial !== undefined ? String(rawSerial).trim() : null;
    return {
      ...base,
      status: 'valid',
      captured_at: naive,
      serial: serial && serial.length > 0 ? serial : null,
      make,
      model,
      has_gps: isValidGps(meta.latitude, meta.longitude),
    };
  } catch {
    return base;
  }
}

// Mirrors is_valid_gps in services/ingestion/utils.py: a number pair in
// range, and not exactly 0,0, the value cameras write before a GPS fix.
function isValidGps(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
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
