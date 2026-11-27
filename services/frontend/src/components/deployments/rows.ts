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
 * question: a short trip, which the server decides (short_trip on the
 * list, the same rule as the Needs attention count), that nobody answered.
 */
import type { Correction, DeploymentListItem } from '../../api/deployments';
import { daysOverlap } from './format';

export interface DeploymentRow {
  // The camera and the moment the deployment starts. Both come from the
  // photos, not from the row id, which a rebuild may change: after Wrong and
  // Undo the same deployment has the same key.
  key: string;
  deployment: DeploymentListItem;
  previous?: DeploymentListItem; // right before it, at another site
  distanceM?: number; // from the previous pin to this one
  // Looks like a GPS error, see DeploymentListItem.short_trip.
  shortTrip: boolean;
  // A short trip nobody answered: the app doubts it and asks.
  suspicious: boolean;
  // A person's correction covers part of its days.
  corrected: boolean;
}

function metresBetween(a: DeploymentListItem, b: DeploymentListItem): number | undefined {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return undefined;
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export const rowKey = (cameraId: number, startAt: string) => `${cameraId}@${startAt}`;

/**
 * Whether a correction covers part of a deployment's days (YYYY-MM-DD,
 * null = open). How a correction is matched to the card or row it made.
 */
export const covers = (c: Correction, cameraId: number, startDate: string | null, endDate: string | null) =>
  c.camera_id === cameraId && daysOverlap(c.from_date, c.until_date, startDate, endDate);

/**
 * Every deployment of the project, newest first. `corrections` are the
 * project's corrections in force; only those a person made count, not the
 * ones an upload set or the update carried over: nobody decided those.
 */
export function deploymentRows(deployments: DeploymentListItem[], corrections: Correction[] = []): DeploymentRow[] {
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
      // Right before it: the end of one is the start of the next.
      const before = list[i - 1]?.end_at === d.start_at ? list[i - 1] : undefined;
      const previous = before && before.site_id !== d.site_id ? before : undefined;
      rows.push({
        key: rowKey(d.camera_id, d.start_at),
        deployment: d,
        previous,
        distanceM: previous && metresBetween(previous, d),
        shortTrip: d.short_trip,
        suspicious: d.short_trip && d.checked_at === null,
        corrected: people.some((c) => covers(c, d.camera_id, d.start_date, d.end_date)),
      });
    });
  }
  return rows.sort((a, b) =>
    b.deployment.start_at.localeCompare(a.deployment.start_at) || a.key.localeCompare(b.key));
}

/** Why a deployment is suspicious, for the pill's tooltip. */
export const SUSPICIOUS_REASON = 'Back at the same site within a week, often a GPS error';
