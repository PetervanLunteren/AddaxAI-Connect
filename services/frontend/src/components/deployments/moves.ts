/**
 * The rows of the Moves page, worked out from the deployments list and the
 * corrections. Plain functions, no React.
 *
 * A row is one of two kinds:
 * - moved: a deployment the GPS made that starts where the camera's
 *   previous one ends
 * - corrected: a correction a person made (a statement), from "It stayed"
 *   in the check or from the camera panel
 * The rest is handled where it belongs: a camera that started somewhere
 * has nothing to check (naming a new place is in the site panel), and
 * photos without a site are a camera's problem, on the Cameras page.
 *
 * Nobody has to answer. A move nobody checked yet that came back to the
 * same site within a week is suspicious, the usual shape of a GPS error.
 * The server counts the same rule for the badge (ATTENTION_COUNT_SQL in
 * routers/deployments.py); a test holds the two together.
 */
import type { DeploymentListItem, FixedPeriod } from '../../api/deployments';
import { formatDate } from '../../utils/datetime';
import { isAutoSiteName } from '../../utils/site-names';

// A move that comes back to the site it left within this many days is
// marked "Back within a week": the usual shape of a false move. It changes
// no data. The same number as SHORT_TRIP_DAYS in routers/deployments.py.
const SHORT_TRIP_DAYS = 7;

export interface MoveRow {
  key: string;
  kind: 'moved' | 'corrected';
  cameraId: number;
  cameraLabel: string;
  day: string; // YYYY-MM-DD, the first day of the entry
  answered: boolean; // a person said it is right
  suspicious: boolean;
  deployment?: DeploymentListItem;
  previous?: DeploymentListItem; // the deployment it moved from
  distanceM?: number; // from the previous pin to this one
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
 * The key of a move: its camera and the moment it starts. Both come from
 * the photos (the first photo at the new place), not from the row id, which
 * a rebuild may change: after "It stayed" and Undo the same move has the
 * same key, and a correction can point at the move it answered
 * (answers_move_at). Corrections are keyed by their own id, which is stable.
 */
export const moveKey = (cameraId: number, startAt: string) => `m${cameraId}@${startAt}`;
export const correctionKey = (statementId: number) => `s${statementId}`;

/**
 * Every entry, answered or not, newest first. `corrections` are the
 * project's statements in force; only those a person made count, not the
 * ones an upload set or the update carried over: nobody decided those.
 */
export function moveRows(deployments: DeploymentListItem[], corrections: FixedPeriod[] = []): MoveRow[] {
  const byCamera = new Map<number, DeploymentListItem[]>();
  for (const d of deployments) {
    const list = byCamera.get(d.camera_id) ?? [];
    list.push(d);
    byCamera.set(d.camera_id, list);
  }
  const items: MoveRow[] = [];
  for (const list of byCamera.values()) {
    list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    list.forEach((d, i) => {
      const before = list[i - 1];
      const previous = before && before.end_at === d.start_at ? before : undefined;
      if (d.site_source !== 'auto' || !previous) return; // not a move
      const next = list[i + 1];
      const shortTrip = !!previous && !!next && next.start_at === d.end_at &&
        next.site_id === previous.site_id && daysBetween(d.start_at, d.end_at!) <= SHORT_TRIP_DAYS;
      items.push({
        key: moveKey(d.camera_id, d.start_at),
        kind: 'moved',
        cameraId: d.camera_id,
        cameraLabel: d.camera_label ?? `Camera ${d.camera_id}`,
        day: d.start_at.slice(0, 10),
        answered: d.checked_at !== null,
        suspicious: d.checked_at === null && shortTrip,
        deployment: d,
        previous,
        distanceM: metresBetween(previous, d),
      });
    });
  }
  for (const c of corrections) {
    if (c.source !== 'person') continue;
    items.push({
      key: correctionKey(c.id),
      kind: 'corrected',
      cameraId: c.camera_id,
      cameraLabel: c.camera_label,
      day: c.from_date,
      answered: true,
      suspicious: false,
      correction: c,
    });
  }
  return items.sort((a, b) => b.day.localeCompare(a.day) || a.cameraLabel.localeCompare(b.cameraLabel));
}

export const metresLabel = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * What a person decided, the Status column of the Moves page.
 * - notChecked: a move nobody answered.
 * - checked: a move a person said is right.
 * - corrected: a correction a person made (a move answered "It stayed" is gone,
 *   its correction is what is left).
 * Suspicious is not a status but what the app thinks of a move nobody
 * checked yet (`suspicious` on the item), shown as a pill next to it.
 */
export type RowStatus = 'notChecked' | 'checked' | 'corrected';

export const STATUS_LABELS: Record<RowStatus, string> = {
  notChecked: 'Not checked',
  checked: 'Checked',
  corrected: 'Corrected',
};

export function rowStatus(it: MoveRow): RowStatus {
  if (it.kind === 'corrected') return 'corrected';
  return it.answered ? 'checked' : 'notChecked';
}

/** Why a move is suspicious, for the pill's tooltip. */
export const SUSPICIOUS_REASON = 'Back at the same site within a week, often a GPS error';

/** Who decided and on which day (YYYY-MM-DD), for checked and corrected rows. */
export function decided(it: MoveRow): { by: string | null; day: string } | null {
  if (it.correction) return { by: it.correction.created_by, day: it.correction.created_at.slice(0, 10) };
  const d = it.deployment;
  if (it.answered && d?.checked_at) return { by: d.checked_by, day: d.checked_at.slice(0, 10) };
  return null;
}

const STATUS_ORDER: RowStatus[] = ['notChecked', 'checked', 'corrected'];

/** The table's first order: suspicious moves, then the rest nobody checked,
 *  then history, each newest first. */
export function defaultOrder(items: MoveRow[]): MoveRow[] {
  const rank = (it: MoveRow) => (it.suspicious ? -1 : STATUS_ORDER.indexOf(rowStatus(it)));
  return [...items].sort((a, b) => rank(a) - rank(b) || b.day.localeCompare(a.day));
}

/** The sites a row is about: both ends of a move, else its one site. */
export function siteIds(it: MoveRow): number[] {
  return [it.deployment?.site_id, it.previous?.site_id, it.correction?.site_id]
    .filter((id): id is number => id != null);
}

// Words for a row, in the table and the check.

// Plain day labels from YYYY-MM-DD, never shifted by the browser's timezone.
export const dayLabel = (day: string) => formatDate(`${day}T12:00:00`);

export const placeName = (name: string | null | undefined) =>
  !name ? 'no site' : isAutoSiteName(name) ? 'a new place' : name;

/** The site a move left (null for a correction) and the site it went to. */
export function ends(it: MoveRow): { from: string | null; to: string } {
  if (it.kind === 'corrected') return { from: null, to: it.correction!.site_name };
  return { from: placeName(it.previous?.site_name), to: placeName(it.deployment?.site_name) };
}

/** Where the camera went, short: "Pond → Ridge", or a correction's site. */
export function route(it: MoveRow): string {
  const { from, to } = ends(it);
  return from === null ? to : `${from} → ${to}`;
}

/** The day of a move, or the days of a correction. */
export function dateLabel(it: MoveRow): string {
  if (it.kind === 'corrected') {
    const c = it.correction!;
    return `${dayLabel(c.from_date)} to ${c.until_date ? dayLabel(c.until_date) : 'now'}`;
  }
  return dayLabel(it.deployment!.start_at.slice(0, 10));
}
