/**
 * The rows of the Deployments page, one per deployment, worked out from the
 * deployments list and the corrections. Plain functions, no React. The
 * deployment cards use the same rows for their Suspicious line, so card and
 * page always agree.
 *
 * A move is not a row of its own: it is how a deployment started. "Moved
 * from" is the deployment right before it, at another site.
 *
 * Nobody has to answer anything. Only a deployment the app doubts asks a
 * question: one the GPS made that came back to the site it left within a
 * week, the usual shape of a GPS error (suspicious). The server counts the
 * same rule for To do (SUSPICIOUS_MOVES_SQL in utils/todo.py); a test holds
 * the two together.
 */
import type { DeploymentListItem, FixedPeriod } from '../../api/deployments';
import { formatDate } from '../../utils/datetime';

// A deployment back at the site it left within this many days is a short
// trip: the usual shape of a false move. The same number as
// SHORT_TRIP_DAYS in utils/todo.py.
const SHORT_TRIP_DAYS = 7;

export interface DeploymentRow {
  // The camera and the moment the deployment starts. Both come from the
  // photos, not from the row id, which a rebuild may change: after Wrong and
  // Undo the same deployment has the same key.
  key: string;
  deployment: DeploymentListItem;
  previous?: DeploymentListItem; // right before it, at another site
  distanceM?: number; // from the previous pin to this one
  // The GPS made it, and the camera is back at the old site within a week.
  shortTrip: boolean;
  // A short trip nobody answered: the app doubts it and asks.
  suspicious: boolean;
  // A person's correction covers part of its days.
  corrected: boolean;
}

export function metresBetween(a: DeploymentListItem, b: DeploymentListItem): number | undefined {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return undefined;
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

export const rowKey = (cameraId: number, startAt: string) => `${cameraId}@${startAt}`;

/**
 * Whether a correction covers part of a deployment's days (YYYY-MM-DD,
 * null = open). How a correction is matched to the card or row it made.
 */
export const covers = (p: FixedPeriod, cameraId: number, startDate: string | null, endDate: string | null) =>
  p.camera_id === cameraId && startDate !== null &&
  (p.until_date === null || p.until_date >= startDate) &&
  (endDate === null || p.from_date <= endDate);

/**
 * Every deployment of the project, newest first. `corrections` are the
 * project's statements in force; only those a person made count, not the
 * ones an upload set or the update carried over: nobody decided those.
 */
export function deploymentRows(deployments: DeploymentListItem[], corrections: FixedPeriod[] = []): DeploymentRow[] {
  const byCamera = new Map<number, DeploymentListItem[]>();
  for (const d of deployments) {
    const list = byCamera.get(d.camera_id) ?? [];
    list.push(d);
    byCamera.set(d.camera_id, list);
  }
  const people = corrections.filter((c) => c.source === 'person');
  const rows: DeploymentRow[] = [];
  for (const list of byCamera.values()) {
    list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    list.forEach((d, i) => {
      // Right before and right after it: the end of one is the start of
      // the next. The short trip rule is the one of SUSPICIOUS_MOVES_SQL.
      const before = list[i - 1]?.end_at === d.start_at ? list[i - 1] : undefined;
      const after = list[i + 1]?.start_at === d.end_at ? list[i + 1] : undefined;
      const previous = before && before.site_id !== d.site_id ? before : undefined;
      const shortTrip = d.site_source === 'auto' && !!before && !!after &&
        after.site_id === before.site_id && daysBetween(d.start_at, d.end_at!) <= SHORT_TRIP_DAYS;
      rows.push({
        key: rowKey(d.camera_id, d.start_at),
        deployment: d,
        previous,
        distanceM: previous && metresBetween(previous, d),
        shortTrip,
        suspicious: shortTrip && d.checked_at === null,
        corrected: people.some((c) => covers(c, d.camera_id, d.start_date, d.end_date)),
      });
    });
  }
  return rows.sort((a, b) =>
    b.deployment.start_at.localeCompare(a.deployment.start_at) || a.key.localeCompare(b.key));
}

export const metresLabel = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** Why a deployment is suspicious, for the pill's tooltip. */
export const SUSPICIOUS_REASON = 'Back at the same site within a week, often a GPS error';

// Plain day labels from YYYY-MM-DD, never shifted by the browser's timezone.
export const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

// The site's own name, as on the Sites page and in the camera panel, also
// while it is still the automatic "Site at 52.0935, 5.8149": one place has
// one name everywhere. Tables mark that one Unnamed.
export const placeName = (name: string | null | undefined) => name || 'no site';
