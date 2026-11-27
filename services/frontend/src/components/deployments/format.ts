/**
 * How deployments are worded: days, distances, names. One place, so a card,
 * a table cell and a sentence say the same thing the same way.
 */
import { formatDate } from '../../utils/datetime';

// Plain day labels from YYYY-MM-DD, never shifted by the browser's timezone.
export const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

/** "1 Aug 2026 to 31 Aug 2026", "to now" while the camera is still there. */
export const daySpan = (startDate: string | null, endDate: string | null) =>
  `${startDate ? dayLabel(startDate) : '-'} to ${endDate ? dayLabel(endDate) : 'now'}`;

/** Today as YYYY-MM-DD on the browser's own clock, as a date field shows it. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Whether two periods of days (YYYY-MM-DD) share a day. A null end is still
 * open. A null start is a period without days, which overlaps nothing.
 */
export const daysOverlap = (
  aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null,
) =>
  aStart !== null && bStart !== null &&
  (aEnd === null || bStart <= aEnd) && (bEnd === null || aStart <= bEnd);

export const metresLabel = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// The site's own name, as on the Sites page, also while it is still the
// automatic "Site at 52.0935, 5.8149": one place has one name everywhere.
// Without a site: siteLabel on its own (a card, a cell), placeName inside a
// sentence.
export const siteLabel = (name: string | null | undefined) => name || 'No site';
export const placeName = (name: string | null | undefined) => name || 'no site';

export const cameraLabel = (label: string | null | undefined, cameraId: number) => label || `Camera ${cameraId}`;
