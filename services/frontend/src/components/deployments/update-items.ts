/**
 * The camera updates: what the app noticed, worked out from the deployments
 * list. Plain functions, no React.
 *
 * An update is one of three kinds:
 * - started: a camera's first deployment, or the first after a gap
 * - moved: a deployment that starts where the camera's previous one ends
 * - unplaced: photos of a camera that no deployment covers
 * Only deployments the GPS made are updates. One a person set is their own
 * word and is not news.
 *
 * Nobody has to answer. Two kinds need a person (needsYou): photos without
 * a site, and a move that came back within a week, the usual shape of a
 * false move. The server counts the same rule for the sidebar badge
 * (ATTENTION_COUNT_SQL in routers/deployments.py); a test holds the two
 * together.
 */
import type { DeploymentListItem, DeploymentsOverview, UnplacedPhotos } from '../../api/deployments';
import { formatDate } from '../../utils/datetime';
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
        needsYou: d.checked_at === null && shortTrip,
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

/**
 * The updates of a check, in the order it shows them: every move nobody
 * answered and every camera with photos without a site. The ones that need
 * a person come first, then the newest. A camera that started somewhere is
 * not asked about: naming a new place is an optional action in the site's
 * panel, not a to-do.
 */
export function checkQueue(items: UpdateItem[]): UpdateItem[] {
  const inCheck = items.filter((it) => !it.answered && it.kind !== 'started');
  return [...inCheck.filter((it) => it.needsYou), ...inCheck.filter((it) => !it.needsYou)];
}

// Words for an update, shared by the log and the check.

// Plain day labels from YYYY-MM-DD, never shifted by the browser's timezone.
export const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

export const placeName = (name: string | null | undefined) =>
  !name ? 'no site' : isAutoSiteName(name) ? 'a new place' : name;

/** "moved from Pond to Ridge", without the camera. */
export function headline(it: UpdateItem): string {
  if (it.kind === 'unplaced') return 'has photos without a site';
  const site = placeName(it.deployment?.site_name);
  if (it.kind === 'started') return `started sending ${site === 'a new place' ? 'from a new place' : `at ${site}`}`;
  return `moved from ${placeName(it.previous?.site_name)} to ${site}`;
}

/** The facts under the headline: distance and the photos around the move. */
export function context(it: UpdateItem): string {
  if (it.kind === 'unplaced') {
    const days = it.unplaced!.photo_days;
    return `From ${dayLabel(days[0].start)} to ${dayLabel(days[days.length - 1].end)}. This camera sent no GPS on these days.`;
  }
  const d = it.deployment!;
  if (it.kind === 'started') {
    return isAutoSiteName(d.site_name) ? 'No site within 250 m, so the app made one.' : 'A site you already have.';
  }
  const p = it.previous!;
  const parts = [
    it.distanceM !== undefined ? metresLabel(it.distanceM) : null,
    p.last_photo_at ? `last photo at ${placeName(p.site_name)} ${dayLabel(p.last_photo_at.slice(0, 10))}` : null,
    `first at ${placeName(d.site_name)} ${dayLabel(d.start_at.slice(0, 10))}`,
  ];
  return parts.filter(Boolean).join(', ');
}
