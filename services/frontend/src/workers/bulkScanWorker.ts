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
// EXIF reads are cheap (~5 ms per file on a small head slice). We
// still parallelize because file.slice() + arrayBuffer() does real
// IO, and overlapping a few reads keeps the pipeline full. 8 is a
// safe upper bound: most browsers cap IO concurrency around this
// anyway, and memory stays trivial (8 x 256 KB = 2 MB peak).
const SCAN_CONCURRENCY = 8;

interface TimingBucket {
  slice_ms: number;
  exif_ms: number;
  total_ms: number;
  timed_out: number;
  byte_total: number;
  count: number;
}

function emptyBucket(): TimingBucket {
  return { slice_ms: 0, exif_ms: 0, total_ms: 0, timed_out: 0, byte_total: 0, count: 0 };
}

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { files } = event.data;
  const total = files.length;
  const entries: ScanEntry[] = new Array(total);
  let nextIndex = 0;
  let completed = 0;

  // Aggregate per-batch timing so we can spot which stage is slow
  // without flooding the console with 832 lines.
  const bucket = emptyBucket();
  const overallStart = performance.now();
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  console.log(
    `[bulk-scan] start, files=${total}, totalBytes=${(totalBytes / 1024 / 1024).toFixed(1)} MB, concurrency=${SCAN_CONCURRENCY}`,
  );

  const post = (done: number) => {
    const progress: ScanProgress = { type: 'progress', done, total };
    (self as unknown as Worker).postMessage(progress);
    if (bucket.count > 0) {
      const elapsed = performance.now() - overallStart;
      const rate = done / (elapsed / 1000);
      console.log(
        `[bulk-scan] ${done}/${total}, batch avg `
        + `slice=${(bucket.slice_ms / bucket.count).toFixed(1)} ms, `
        + `exif=${(bucket.exif_ms / bucket.count).toFixed(1)} ms, `
        + `total=${(bucket.total_ms / bucket.count).toFixed(1)} ms/file, `
        + `bytes=${(bucket.byte_total / bucket.count / 1024).toFixed(0)} KB/file, `
        + `timeouts=${bucket.timed_out}, `
        + `throughput=${rate.toFixed(1)} files/s`,
      );
      Object.assign(bucket, emptyBucket());
    }
  };

  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      const result = await scanOneTimed(i, files[i]);
      entries[i] = result.entry;
      bucket.slice_ms += result.slice_ms;
      bucket.exif_ms += result.exif_ms;
      bucket.total_ms += result.total_ms;
      bucket.byte_total += result.bytes_read;
      bucket.timed_out += result.timed_out ? 1 : 0;
      bucket.count += 1;
      completed += 1;
      if (completed % PROGRESS_EVERY === 0 || completed === total) {
        post(completed);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, total) }, () => worker()),
  );

  const elapsed = performance.now() - overallStart;
  console.log(
    `[bulk-scan] done in ${(elapsed / 1000).toFixed(1)} s, `
    + `${(total / (elapsed / 1000)).toFixed(1)} files/s avg`,
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

interface ScanOneResult {
  entry: ScanEntry;
  slice_ms: number;
  exif_ms: number;
  total_ms: number;
  bytes_read: number;
  timed_out: boolean;
}

async function scanOneTimed(index: number, file: File): Promise<ScanOneResult> {
  const t0 = performance.now();
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
  let slice_ms = 0;
  let exif_ms = 0;
  let bytes_read = 0;
  let timed_out = false;
  try {
    // Materialize the first 256 KB into an ArrayBuffer so we can
    // time the disk read separately from exifr's parse work.
    const tSlice = performance.now();
    const head = await file.slice(0, HEAD_BYTES).arrayBuffer();
    slice_ms = performance.now() - tSlice;
    bytes_read = head.byteLength;

    const tExif = performance.now();
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
    exif_ms = performance.now() - tExif;
    if (meta === null) timed_out = true;

    if (!meta || !meta.DateTimeOriginal) {
      return {
        entry: { ...base, status: 'missing_exif_datetime' },
        slice_ms, exif_ms, total_ms: performance.now() - t0, bytes_read, timed_out,
      };
    }
    const naive = parseExifDateNaive(meta.DateTimeOriginal);
    if (!naive) {
      return {
        entry: { ...base, status: 'missing_exif_datetime' },
        slice_ms, exif_ms, total_ms: performance.now() - t0, bytes_read, timed_out,
      };
    }
    const rawSerial = meta.BodySerialNumber ?? meta.SerialNumber ?? null;
    const serial =
      rawSerial !== null && rawSerial !== undefined ? String(rawSerial).trim() : null;

    return {
      entry: {
        ...base,
        status: 'valid',
        captured_at: naive,
        serial: serial && serial.length > 0 ? serial : null,
      },
      slice_ms, exif_ms, total_ms: performance.now() - t0, bytes_read, timed_out,
    };
  } catch (err) {
    console.warn('[bulk-scan] scan error on', file.name, err);
    return {
      entry: base,
      slice_ms, exif_ms, total_ms: performance.now() - t0, bytes_read, timed_out,
    };
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
