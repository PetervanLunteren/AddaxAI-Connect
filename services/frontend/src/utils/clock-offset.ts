/**
 * Camera clock correction for bulk uploads.
 *
 * Capture times are naive camera wall-clock strings ("YYYY-MM-DDTHH:MM:SS",
 * see the timestamp rules in DEVELOPERS.md), and the worker adds the
 * offset to them as naive datetimes. All arithmetic here therefore runs on
 * the wall clock, pinned to UTC, and never through `new Date(str)` in the
 * browser's timezone: an epoch difference taken across a summer time
 * switch in the viewer's timezone is an hour off the wall-clock one. That
 * exact bug shifted every corrected date by an hour in the desktop
 * AddaxAI, where this design comes from.
 */

/** The largest correction the API accepts, kept equal to
 * MAX_TIME_OFFSET_SECONDS in services/api/routers/bulk_upload.py. */
export const MAX_TIME_OFFSET_SECONDS = 30 * 366 * 24 * 3600;

const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/** Milliseconds of a naive wall-clock string, pinned to UTC. */
export function naiveMs(value: string | null | undefined): number | null {
  const m = value ? NAIVE_RE.exec(value) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
}

/** Inverse of naiveMs, in the datetime-local input format. */
export function naiveString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/** A naive wall-clock string moved by a number of seconds. */
export function shiftNaive(value: string, seconds: number): string {
  const ms = naiveMs(value);
  return ms === null ? value : naiveString(ms + seconds * 1000);
}

/** The scan entries with every capture time corrected. The same array
 * when there is no correction, so memoised consumers do not rerun. */
export function shiftEntries<T extends { captured_at: string | null }>(
  entries: T[],
  seconds: number,
): T[] {
  if (seconds === 0) return entries;
  return entries.map((e) =>
    e.captured_at ? { ...e, captured_at: shiftNaive(e.captured_at, seconds) } : e,
  );
}

/** "3 Jun 2026, 14:31:07" for a naive wall-clock string, as written. */
export function formatNaive(value: string | null | undefined): string {
  const ms = naiveMs(value);
  if (ms === null) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(ms));
}

/** "+1 hour", "-7 days, 3 hours", "No correction". */
export function formatOffset(seconds: number): string {
  if (seconds === 0) return 'No correction';
  const abs = Math.abs(seconds);
  const parts: string[] = [];
  const add = (n: number, unit: string) => {
    if (n) parts.push(`${n} ${unit}${n === 1 ? '' : 's'}`);
  };
  add(Math.floor(abs / 86400), 'day');
  add(Math.floor((abs % 86400) / 3600), 'hour');
  add(Math.floor((abs % 3600) / 60), 'minute');
  add(abs % 60, 'second');
  return `${seconds > 0 ? '+' : '-'}${parts.join(', ')}`;
}
