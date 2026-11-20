/**
 * The rows of the Deployments timeline, worked out from the project-wide
 * list. Plain functions, no React, so the page and the chart stay small.
 *
 * A row is a camera or a site. Bars that overlap in time go on separate
 * lanes of their row: a site where two cameras stood at once gets two
 * lanes. A camera never overlaps itself, so camera rows have one lane.
 */
import type { DaySpan, DeploymentListItem, DeploymentsOverview } from '../../api/deployments';

export type RowMode = 'camera' | 'site';

export interface Bar {
  id: number;
  cameraId: number;
  start: string; // first day, YYYY-MM-DD
  end: string; // last day; an open deployment runs to today
  open: boolean;
  label: string; // the site in camera rows, the camera in site rows
  fixed: boolean;
  photoDays: DaySpan[];
  deployment: DeploymentListItem;
}

export interface TimelineRow {
  key: string;
  label: string;
  lanes: Bar[][];
  // Photo days without a site. Only in camera rows and the "No site yet" row.
  unplaced: DaySpan[];
}

export interface RowFilters {
  cameraIds: Set<number> | null; // null = all
  siteIds: Set<number> | null;
  from: string | null;
  to: string | null;
}

export const today = () => new Date().toISOString().slice(0, 10);

const overlaps = (start: string, end: string, f: RowFilters) =>
  (f.to === null || start <= f.to) && (f.from === null || end >= f.from);

const spansIn = (spans: DaySpan[], f: RowFilters) => spans.filter((s) => overlaps(s.start, s.end, f));

function toBar(d: DeploymentListItem, mode: RowMode): Bar {
  return {
    id: d.id,
    cameraId: d.camera_id,
    start: d.start_date ?? d.start_at.slice(0, 10),
    end: d.end_date ?? today(),
    open: d.end_date === null,
    label: (mode === 'camera' ? d.site_name : d.camera_label) ?? 'No site',
    fixed: d.site_source === 'manual',
    photoDays: d.photo_days,
    deployment: d,
  };
}

/** Bars on the fewest lanes, oldest first, so no two on a lane overlap. */
function intoLanes(bars: Bar[]): Bar[][] {
  const lanes: Bar[][] = [];
  for (const bar of [...bars].sort((a, b) => a.start.localeCompare(b.start))) {
    const lane = lanes.find((l) => l[l.length - 1].end < bar.start);
    if (lane) lane.push(bar);
    else lanes.push([bar]);
  }
  return lanes;
}

export function buildRows(overview: DeploymentsOverview, mode: RowMode, f: RowFilters): TimelineRow[] {
  const deployments = overview.deployments.filter((d) => {
    const bar = toBar(d, mode);
    return (
      (f.cameraIds === null || f.cameraIds.has(d.camera_id)) &&
      (f.siteIds === null || (d.site_id !== null && f.siteIds.has(d.site_id))) &&
      overlaps(bar.start, bar.end, f)
    );
  });
  // Photos without a site have no site, so a site filter hides them.
  const unplaced = f.siteIds === null
    ? overview.unplaced
        .filter((u) => f.cameraIds === null || f.cameraIds.has(u.camera_id))
        .map((u) => ({ ...u, photo_days: spansIn(u.photo_days, f) }))
        .filter((u) => u.photo_days.length > 0)
    : [];

  const groups = new Map<string, { label: string; bars: Bar[]; unplaced: DaySpan[] }>();
  const group = (key: string, label: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { label, bars: [], unplaced: [] };
      groups.set(key, g);
    }
    return g;
  };
  for (const d of deployments) {
    const bar = toBar(d, mode);
    if (mode === 'camera') group(`c${d.camera_id}`, d.camera_label ?? `Camera ${d.camera_id}`).bars.push(bar);
    else group(`s${d.site_id ?? 'none'}`, d.site_name ?? 'No site').bars.push(bar);
  }
  for (const u of unplaced) {
    const g = mode === 'camera' ? group(`c${u.camera_id}`, u.camera_label) : group('unplaced', 'No site yet');
    g.unplaced.push(...u.photo_days);
  }

  return Array.from(groups.entries())
    .map(([key, g]) => ({ key, label: g.label, lanes: g.bars.length ? intoLanes(g.bars) : [[]], unplaced: g.unplaced }))
    .sort((a, b) => {
      if (a.key === 'unplaced') return 1;
      if (b.key === 'unplaced') return -1;
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
}

/** The first and last day to draw: the filter where set, else the data, up to today. */
export function rowsDomain(rows: TimelineRow[], f: RowFilters): { from: string; to: string } {
  let from = f.from;
  if (from === null) {
    for (const r of rows) {
      for (const lane of r.lanes) for (const b of lane) if (from === null || b.start < from) from = b.start;
      for (const s of r.unplaced) if (from === null || s.start < from) from = s.start;
    }
  }
  return { from: from ?? today(), to: f.to ?? today() };
}
