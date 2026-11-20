/**
 * The entries of the Camera updates page, worked out from the deployments
 * list the page loads. Plain functions, no React.
 *
 * An entry is something the app noticed:
 * - started: a camera's first deployment, or the first after a gap
 * - moved: a deployment that starts where the camera's previous one ends
 * - unplaced: photos of a camera that no deployment covers
 * Only deployments the GPS made are entries. One a person set is their own
 * word and is not news.
 *
 * Nobody has to answer an entry. A few need a person (needsYou): photos
 * without a site, a place that still has the name the app gave it, and a
 * move that came back within a week. The server counts the same rule for
 * the sidebar badge (ATTENTION_COUNT_SQL in routers/deployments.py); a test
 * holds the two together.
 */
import type { DeploymentListItem, DeploymentsOverview, UnplacedPhotos } from '../../api/deployments';
import { isAutoSiteName } from '../../utils/site-names';

// A move that comes back to the site it left within this many days is
// marked "Back within a week": the usual shape of a false move. It changes
// no data. The same number as SHORT_TRIP_DAYS in routers/deployments.py.
const SHORT_TRIP_DAYS = 7;

export interface UpdateItem {
  key: string;
  kind: 'started' | 'moved' | 'unplaced';
  cameraId: number;
  cameraLabel: string;
  day: string; // YYYY-MM-DD, the first day of the entry
  answered: boolean; // a person said it is right
  needsYou: boolean;
  deployment?: DeploymentListItem;
  previous?: DeploymentListItem; // the deployment it moved from
  distanceM?: number; // from the previous pin to this one
  // The out leg of a trip that came back within a week: the likely false move.
  shortTrip?: boolean;
  // The way back of such a trip. "It did not move" belongs on the out leg.
  returnOfShortTrip?: boolean;
  unplaced?: UnplacedPhotos;
}

export interface UpdateFilters {
  cameraIds: Set<number> | null;
  siteIds: Set<number> | null;
  from: string | null;
  to: string | null;
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

/** Every entry, answered or not, newest first. */
export function updateItems(overview: DeploymentsOverview): UpdateItem[] {
  const byCamera = new Map<number, DeploymentListItem[]>();
  for (const d of overview.deployments) {
    const list = byCamera.get(d.camera_id) ?? [];
    list.push(d);
    byCamera.set(d.camera_id, list);
  }
  const items: UpdateItem[] = [];
  for (const list of byCamera.values()) {
    list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    list.forEach((d, i) => {
      if (d.site_source !== 'auto') return;
      const before = list[i - 1];
      const previous = before && before.end_at === d.start_at ? before : undefined;
      const next = list[i + 1];
      const shortTrip = !!previous && !!next && next.start_at === d.end_at &&
        next.site_id === previous.site_id && daysBetween(d.start_at, d.end_at!) <= SHORT_TRIP_DAYS;
      const beforePrevious = previous ? list[i - 2] : undefined;
      const returnOfShortTrip = !!previous && !!beforePrevious && beforePrevious.end_at === previous.start_at &&
        beforePrevious.site_id === d.site_id && previous.end_at !== null &&
        daysBetween(previous.start_at, previous.end_at) <= SHORT_TRIP_DAYS;
      items.push({
        key: `d${d.id}`,
        kind: previous ? 'moved' : 'started',
        cameraId: d.camera_id,
        cameraLabel: d.camera_label ?? `Camera ${d.camera_id}`,
        day: d.start_at.slice(0, 10),
        answered: d.checked_at !== null,
        needsYou: d.checked_at === null && (isAutoSiteName(d.site_name) || shortTrip),
        deployment: d,
        previous,
        distanceM: previous ? metresBetween(previous, d) : undefined,
        shortTrip,
        returnOfShortTrip,
      });
    });
  }
  for (const u of overview.unplaced) {
    items.push({
      key: `u${u.camera_id}`,
      kind: 'unplaced',
      cameraId: u.camera_id,
      cameraLabel: u.camera_label,
      day: u.photo_days[0]?.start ?? '',
      answered: false,
      needsYou: true, // until the photos have a site
      unplaced: u,
    });
  }
  return items.sort((a, b) => b.day.localeCompare(a.day) || a.cameraLabel.localeCompare(b.cameraLabel));
}

/** The entries the filter bar lets through. */
export function filterItems(items: UpdateItem[], f: UpdateFilters): UpdateItem[] {
  return items.filter((it) =>
    (f.cameraIds === null || f.cameraIds.has(it.cameraId)) &&
    (f.siteIds === null ||
      [it.deployment?.site_id, it.previous?.site_id].some((s) => s != null && f.siteIds!.has(s))) &&
    (f.from === null || it.day >= f.from) &&
    (f.to === null || it.day <= f.to),
  );
}

export const metresLabel = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** "This week", "Last week" or "Earlier", by the Monday that starts the week. */
export function weekOf(day: string, today: Date = new Date()): 'This week' | 'Last week' | 'Earlier' {
  const monday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const age = (monday.getTime() - Date.parse(day)) / 86_400_000;
  return age <= 0 ? 'This week' : age <= 7 ? 'Last week' : 'Earlier';
}
