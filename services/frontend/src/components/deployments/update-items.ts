/**
 * The camera updates: what the app noticed, worked out from the deployments
 * list. Plain functions, no React.
 *
 * An update is one of four kinds:
 * - started: a camera's first deployment, or the first after a gap
 * - moved: a deployment that starts where the camera's previous one ends
 * - unplaced: photos of a camera that no deployment covers
 * - corrected: a correction a person made (a statement), from Wrong in the
 *   check or from the camera panel. Listed under Checked with Undo.
 * Only deployments the GPS made are moves. One a person set is their own
 * word and shows as the correction that made it.
 *
 * Nobody has to answer. Two kinds need a person (needsYou): photos without
 * a site, and a move that came back within a week, the usual shape of a
 * false move. The server counts the same rule for the sidebar badge
 * (ATTENTION_COUNT_SQL in routers/deployments.py); a test holds the two
 * together.
 */
import type { DeploymentListItem, DeploymentsOverview, FixedPeriod, UnplacedPhotos } from '../../api/deployments';
import { formatDate } from '../../utils/datetime';
import { isAutoSiteName } from '../../utils/site-names';

// A move that comes back to the site it left within this many days is
// marked "Back within a week": the usual shape of a false move. It changes
// no data. The same number as SHORT_TRIP_DAYS in routers/deployments.py.
const SHORT_TRIP_DAYS = 7;

export interface UpdateItem {
  key: string;
  kind: 'started' | 'moved' | 'unplaced' | 'corrected';
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
  // The way back of such a trip. "It stayed at …" belongs on the out leg.
  returnOfShortTrip?: boolean;
  unplaced?: UnplacedPhotos;
  correction?: FixedPeriod;
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

/**
 * Every entry, answered or not, newest first. `corrections` are the
 * project's statements in force; only those a person made count, not the
 * ones an upload set or the update carried over: nobody decided those.
 */
export function updateItems(overview: DeploymentsOverview, corrections: FixedPeriod[] = []): UpdateItem[] {
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
  for (const c of corrections) {
    if (c.source !== 'person') continue;
    items.push({
      key: `s${c.id}`,
      kind: 'corrected',
      cameraId: c.camera_id,
      cameraLabel: c.camera_label,
      day: c.from_date,
      answered: true,
      needsYou: false,
      correction: c,
    });
  }
  return items.sort((a, b) => b.day.localeCompare(a.day) || a.cameraLabel.localeCompare(b.cameraLabel));
}

export const metresLabel = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * The three groups of the Camera updates menu; each opens the check with
 * its own updates, newest first.
 * - needsYou: photos without a site, and moves back within a week. The
 *   count on the button and the sidebar badge (ATTENTION_COUNT_SQL).
 * - notChecked: ordinary moves nobody answered. Findable, not asking.
 * - checked: everything a person decided, to review and undo: moves said
 *   to be right, and corrections (a move answered Wrong is gone, its
 *   correction is what is left).
 * A camera that started somewhere is in none: naming a new place is an
 * optional action in the site's panel, not a to-do.
 */
export type UpdateGroup = 'needsYou' | 'notChecked' | 'checked';

export const UPDATE_GROUPS: { key: UpdateGroup; label: string }[] = [
  { key: 'needsYou', label: 'Needs you' },
  { key: 'notChecked', label: 'Not checked yet' },
  { key: 'checked', label: 'Checked' },
];

export function updateGroup(items: UpdateItem[], group: UpdateGroup): UpdateItem[] {
  return items.filter((it) => {
    if (it.kind === 'started') return false;
    if (group === 'checked') return it.answered; // corrections are answered

    return !it.answered && it.needsYou === (group === 'needsYou');
  });
}

// Words for an update in the check.

// Plain day labels from YYYY-MM-DD, never shifted by the browser's timezone.
export const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

export const placeName = (name: string | null | undefined) =>
  !name ? 'no site' : isAutoSiteName(name) ? 'a new place' : name;

/** Where the camera went, short: "Pond → Ridge"; "None yet" without a site. */
export function route(it: UpdateItem): string {
  if (it.kind === 'unplaced') return 'None yet';
  if (it.kind === 'corrected') return it.correction!.site_name;
  const site = placeName(it.deployment?.site_name);
  if (it.kind === 'started') return `Started at ${site}`;
  return `${placeName(it.previous?.site_name)} → ${site}`;
}

/** The day of a move, or the days of photos without a site or of a correction. */
export function dateLabel(it: UpdateItem): string {
  if (it.kind === 'corrected') {
    const c = it.correction!;
    return `${dayLabel(c.from_date)} to ${c.until_date ? dayLabel(c.until_date) : 'now'}`;
  }
  if (it.kind === 'unplaced') {
    const days = it.unplaced!.photo_days;
    return `${dayLabel(days[0].start)} to ${dayLabel(days[days.length - 1].end)}`;
  }
  return dayLabel(it.deployment!.start_at.slice(0, 10));
}
