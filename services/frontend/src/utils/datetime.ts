/**
 * Shared date formatting helpers. Every formatter respects the browser's
 * navigator.language so a Dutch user sees Dutch month abbreviations and
 * relative labels ("gisteren", "3 dagen geleden"), while an English user
 * sees "yesterday", "3 days ago". Time is always rendered in 24-hour format
 * regardless of locale, matching the way Europeans and field scientists
 * expect camera-trap timestamps to read.
 *
 * Input is any ISO 8601 string parseable by `new Date()`, a unix
 * milliseconds number, or a Date instance. Null, undefined, empty string,
 * and unparseable input all return the caller-provided fallback.
 */

type DateInput = string | number | Date | null | undefined;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

const DATE_SHORT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
};

const MONTH_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
};

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

function parseDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  // Some ingestion paths surface EXIF DateTimeOriginal raw as
  // "YYYY:MM:DD HH:MM:SS"; new Date() rejects the colons in the date
  // segment, so normalise to "YYYY-MM-DDTHH:MM:SS" first.
  const normalised =
    typeof value === 'string'
      ? value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      : value;
  const date = normalised instanceof Date ? normalised : new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3 Apr 2026" / "3 apr. 2026" / "Apr 3, 2026" depending on navigator.language. */
export function formatDate(value: DateInput, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(undefined, DATE_OPTIONS).format(date);
}

/** "3 Apr" / "3 apr." / "Apr 3" — no year, for space-constrained chart axes. */
export function formatDateShort(value: DateInput, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(undefined, DATE_SHORT_OPTIONS).format(date);
}

/** "Apr 2026" / "apr. 2026" — no day, for month-granularity chart axes. */
export function formatMonth(value: DateInput, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(undefined, MONTH_OPTIONS).format(date);
}

/** "3 Apr 2026, 14:31" / "3 apr. 2026, 14:31" — always 24-hour. */
export function formatDateTime(value: DateInput, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(undefined, DATE_TIME_OPTIONS).format(date);
}

/**
 * Human-friendly relative time for recent dates, locale-aware via
 * Intl.RelativeTimeFormat. Falls through to formatDate() for anything
 * older than 7 days.
 *
 * en: "now", "5 minutes ago", "3 hours ago", "yesterday", "3 days ago", "3 Apr 2026"
 * nl: "nu", "5 minuten geleden", "3 uur geleden", "gisteren", "3 dagen geleden", "3 apr. 2026"
 */
export function formatRelative(value: DateInput, fallback = 'Never'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return formatDate(value, fallback);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffDay >= 7) return formatDate(value, fallback);
  if (diffDay >= 1) return rtf.format(-diffDay, 'day');
  if (diffHr >= 1) return rtf.format(-diffHr, 'hour');
  if (diffMin >= 1) return rtf.format(-diffMin, 'minute');
  return rtf.format(0, 'second');
}
