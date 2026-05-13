/**
 * Deployment timeline chart with two view modes.
 *
 * One `<svg>` hosts:
 *   - Top axis with month / year ticks.
 *   - Middle, one row per camera, prefixed with a status dot.
 *     - Deployment mode: light outer bar per CDP, solid inner segments for
 *       image-observed activity, vertical ticks at CDP boundaries.
 *     - Heatmap mode: a per-day rect grid coloured by image count, with
 *       a faint CDP-window guideline behind it. Switches to weekly bins
 *       when the visible window spans more than a year, so day cells stay
 *       legible on long ranges.
 *   - Bottom, step-function area chart of how many cameras delivered at
 *     least one image each day.
 *
 * Drag-to-zoom on the chart writes back to the parent's date filter.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CdpTransition,
  HeatmapPoint,
  TimelineResponse,
} from '../../api/types';
import { STATUS_COLORS } from '../../utils/camera-colors';

const BAR_INNER = '#0f6064';
const BAR_OUTER_HEATMAP = 'rgba(15, 96, 100, 0.08)';
const CONCURRENT_FILL = 'rgba(15, 96, 100, 0.18)';
const CONCURRENT_STROKE = '#0f6064';
const GRID_STROKE = 'rgba(0, 0, 0, 0.06)';
const AXIS_TEXT = 'rgba(0, 0, 0, 0.65)';
const HOVER_FILL = 'rgba(0, 0, 0, 0.05)';
const TRANSITION_STROKE = 'rgba(0, 0, 0, 0.25)';

// Heatmap intensity ramp: same hue as the inner bar, varying alpha so the
// rest of the chart stays in one colour family. Tuned to one or two images
// being visible without dominating, eleven-plus being solid. Exported so
// the page can render a matching legend without duplicating the table.
export const HEATMAP_BINS: Array<{ min: number; label: string; fill: string }> = [
  { min: 1, label: '1', fill: 'rgba(15, 96, 100, 0.20)' },
  { min: 2, label: '2 to 4', fill: 'rgba(15, 96, 100, 0.40)' },
  { min: 5, label: '5 to 10', fill: 'rgba(15, 96, 100, 0.65)' },
  { min: 11, label: '11+', fill: 'rgba(15, 96, 100, 0.90)' },
];

function heatmapFill(count: number): string | null {
  if (count <= 0) return null;
  let chosen: string | null = null;
  for (const bin of HEATMAP_BINS) {
    if (count >= bin.min) chosen = bin.fill;
  }
  return chosen;
}

type Density = 'normal' | 'compact';
type ViewMode = 'deployment' | 'heatmap';

interface DensityConfig {
  rowHeight: number;
  rowGap: number;
  barHeight: number;
  labelWidth: number;
  showLabels: boolean;
}

const DENSITY: Record<Density, DensityConfig> = {
  normal: { rowHeight: 24, rowGap: 4, barHeight: 14, labelWidth: 180, showLabels: true },
  compact: { rowHeight: 8, rowGap: 1, barHeight: 6, labelWidth: 28, showLabels: false },
};

const CONCURRENT_HEIGHT = 70;
const AXIS_HEIGHT = 28;
const RIGHT_PADDING = 16;
const TOP_PADDING = 4;
const SECTION_GAP = 14;
const CONCURRENT_Y_LABEL_WIDTH = 28;
const STATUS_DOT_GAP = 6;
const WEEKLY_BIN_DAY_THRESHOLD = 365;

const MS_PER_DAY = 86_400_000;

function parseDate(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatYMD(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface MonthTick {
  ms: number;
  label: string;
  major: boolean;
}

function generateMonthTicks(xMinMs: number, xMaxMs: number): MonthTick[] {
  const ticks: MonthTick[] = [];
  const start = new Date(xMinMs);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  if (start.getUTCDate() > 1) m += 1;
  while (true) {
    const tickMs = Date.UTC(y, m, 1);
    if (tickMs > xMaxMs) break;
    const monthName = new Date(tickMs).toLocaleString('en', {
      month: 'short',
      timeZone: 'UTC',
    });
    const major = m === 0;
    ticks.push({ ms: tickMs, label: major ? `${monthName} ${y}` : monthName, major });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return ticks;
}

function thinTicks(ticks: MonthTick[], plotWidth: number): Set<number> {
  const MIN_PX = 56;
  const span = ticks.length > 1 ? ticks.length : 1;
  const spacingPx = plotWidth / span;
  const keep = new Set<number>();
  if (ticks.length === 0) return keep;
  let step = 1;
  while (spacingPx * step < MIN_PX) step += 1;
  for (let i = 0; i < ticks.length; i += step) keep.add(i);
  ticks.forEach((t, i) => {
    if (t.major) keep.add(i);
  });
  return keep;
}

interface DeploymentTimelineChartProps {
  data: TimelineResponse;
  density?: Density;
  viewMode?: ViewMode;
  /** Fired with YYYY-MM-DD strings when the user drag-zooms on the chart. */
  onZoom?: (from: string, to: string) => void;
}

const ZOOM_DRAG_THRESHOLD_PX = 4;

interface HoverInfo {
  x: number;
  y: number;
  title: string;
  subtitle: string;
}

interface CameraHeatmap {
  cellsByMs: Map<number, number>;
}

export function DeploymentTimelineChart({
  data,
  density = 'normal',
  viewMode = 'deployment',
  onZoom,
}: DeploymentTimelineChartProps) {
  const cfg = DENSITY[density];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(960);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [drag, setDrag] = useState<{ startX: number; currentX: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(360, Math.floor(e.contentRect.width)));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Compute x-axis bounds. Trust the backend's `date_range_from / to`,
  // which it has already clipped to the active date filter. Each "day"
  // occupies a full day width, so the upper bound is the start of the
  // day AFTER `date_range_to`. Iterating CDP configured_start values
  // would expand the axis back to dates outside the user's zoom window,
  // which is exactly what drag-to-zoom should avoid.
  const { xMinMs, xMaxMs } = useMemo(() => {
    let lo: number;
    let hi: number;
    if (data.date_range_from && data.date_range_to) {
      lo = parseDate(data.date_range_from);
      hi = parseDate(data.date_range_to) + MS_PER_DAY;
    } else {
      lo = Infinity;
      hi = -Infinity;
      for (const site of data.sites) {
        for (const dep of site.deployments) {
          lo = Math.min(lo, parseDate(dep.configured_start));
          hi = Math.max(hi, parseDate(dep.effective_end) + MS_PER_DAY);
          for (const iv of dep.intervals) {
            lo = Math.min(lo, parseDate(iv.start));
            hi = Math.max(hi, parseDate(iv.end) + MS_PER_DAY);
          }
        }
      }
      if (!isFinite(lo) || !isFinite(hi)) {
        const today = Date.now();
        lo = today - 30 * MS_PER_DAY;
        hi = today + MS_PER_DAY;
      }
    }
    const span = Math.max(MS_PER_DAY, hi - lo);
    const pad = span * 0.02;
    return { xMinMs: lo - pad, xMaxMs: hi + pad };
  }, [data]);

  const plotLeft = cfg.labelWidth;
  const plotWidth = Math.max(40, width - plotLeft - RIGHT_PADDING);

  const xToPx = (ms: number) =>
    plotLeft + ((ms - xMinMs) / Math.max(1, xMaxMs - xMinMs)) * plotWidth;
  const pxToMs = (px: number) =>
    xMinMs + ((px - plotLeft) / Math.max(1, plotWidth)) * (xMaxMs - xMinMs);

  const rowsHeight = data.sites.length * (cfg.rowHeight + cfg.rowGap);
  const totalHeight =
    TOP_PADDING + AXIS_HEIGHT + rowsHeight + SECTION_GAP + CONCURRENT_HEIGHT + 8;

  const ticks = useMemo(() => generateMonthTicks(xMinMs, xMaxMs), [xMinMs, xMaxMs]);
  const tickKeep = useMemo(() => thinTicks(ticks, plotWidth), [ticks, plotWidth]);

  // Pre-index per-camera heatmap counts by epoch ms so each row render is
  // a cheap lookup. When the visible range is long, bin the cell ms to the
  // start of each ISO week so we render seven-day blocks instead of pixel-
  // smearing 365 day cells.
  const visibleDays = Math.max(1, Math.round((xMaxMs - xMinMs) / MS_PER_DAY));
  const useWeeklyBins = viewMode === 'heatmap' && visibleDays > WEEKLY_BIN_DAY_THRESHOLD;
  const cellSpanMs = useWeeklyBins ? 7 * MS_PER_DAY : MS_PER_DAY;

  const heatmapByCamera = useMemo(() => {
    if (viewMode !== 'heatmap') return new Map<number, CameraHeatmap>();
    return buildHeatmapIndex(data.heatmap, useWeeklyBins);
  }, [data.heatmap, viewMode, useWeeklyBins]);

  const transitionsByCamera = useMemo(
    () => groupTransitionsByCamera(data.cdp_transitions),
    [data.cdp_transitions],
  );

  const concurrentMax = useMemo(
    () => Math.max(1, data.metrics.max_concurrent_cameras),
    [data],
  );
  const concurrentTop = TOP_PADDING + AXIS_HEIGHT + rowsHeight + SECTION_GAP;
  const concurrentBottom = concurrentTop + CONCURRENT_HEIGHT;
  const concurrentYToPx = (count: number) =>
    concurrentBottom - (count / concurrentMax) * CONCURRENT_HEIGHT;

  // Per-day step area chart of cameras with a sign of life. Each point's
  // count holds only for that one day; between two non-adjacent points
  // the polygon drops to zero so silent stretches read as actually
  // silent rather than as a held step value carried across the gap.
  const concurrentPath = useMemo(() => {
    const pts = data.concurrent_cameras;
    if (pts.length === 0) return '';
    const parts: string[] = [];
    const firstX = xToPx(parseDate(pts[0].date));
    parts.push(`M ${firstX} ${concurrentBottom}`);
    let prevDateMs = parseDate(pts[0].date);
    let prevY = concurrentYToPx(pts[0].count);
    parts.push(`L ${firstX} ${prevY}`);

    for (let i = 1; i < pts.length; i++) {
      const currDateMs = parseDate(pts[i].date);
      const currY = concurrentYToPx(pts[i].count);
      const isAdjacent = currDateMs - prevDateMs === MS_PER_DAY;
      if (isAdjacent) {
        const currX = xToPx(currDateMs);
        parts.push(`L ${currX} ${prevY}`);
        parts.push(`L ${currX} ${currY}`);
      } else {
        const prevEndX = xToPx(prevDateMs + MS_PER_DAY);
        const currX = xToPx(currDateMs);
        parts.push(`L ${prevEndX} ${prevY}`);
        parts.push(`L ${prevEndX} ${concurrentBottom}`);
        parts.push(`L ${currX} ${concurrentBottom}`);
        parts.push(`L ${currX} ${currY}`);
      }
      prevDateMs = currDateMs;
      prevY = currY;
    }
    const tailX = xToPx(prevDateMs + MS_PER_DAY);
    parts.push(`L ${tailX} ${prevY}`);
    parts.push(`L ${tailX} ${concurrentBottom}`);
    parts.push('Z');
    return parts.join(' ');
  }, [data, xMinMs, xMaxMs, plotWidth]);

  const xFromEvent = (e: React.MouseEvent): number => {
    const svg = (e.currentTarget as Element).closest('svg') as SVGSVGElement | null;
    const rect = (svg ?? (e.currentTarget as SVGSVGElement)).getBoundingClientRect();
    return e.clientX - rect.left;
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const x = xFromEvent(e);
    if (x < plotLeft || x > plotLeft + plotWidth) return;
    setDrag({ startX: x, currentX: x });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag) return;
    setDrag({ ...drag, currentX: xFromEvent(e) });
  };

  const handleMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag) return;
    const x = xFromEvent(e);
    const dragged = Math.abs(x - drag.startX);
    if (dragged >= ZOOM_DRAG_THRESHOLD_PX && onZoom) {
      const a = Math.min(drag.startX, x);
      const b = Math.max(drag.startX, x);
      const fromMs = Math.max(xMinMs, pxToMs(a));
      const toMs = Math.min(xMaxMs, pxToMs(b));
      onZoom(formatYMD(fromMs), formatYMD(toMs));
    }
    setDrag(null);
  };

  // Concurrent-strip hover: look up the count for the day under the
  // cursor. Each signal day has its own point, so if the binary search
  // does not land on a point whose date matches the cursor's day, the
  // cursor is in a silent gap and the count is zero.
  const concurrentPoints = data.concurrent_cameras;
  const handleConcurrentMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (drag) return;
    const x = xFromEvent(e);
    if (x < plotLeft || x > plotLeft + plotWidth) {
      setHover(null);
      return;
    }
    const cursorMs = pxToMs(x);
    const cursorDayMs = Math.floor(cursorMs / MS_PER_DAY) * MS_PER_DAY;
    let count = 0;
    if (concurrentPoints.length > 0) {
      let lo = 0;
      let hi = concurrentPoints.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const midMs = parseDate(concurrentPoints[mid].date);
        if (midMs <= cursorDayMs) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx >= 0 && parseDate(concurrentPoints[idx].date) === cursorDayMs) {
        count = concurrentPoints[idx].count;
      }
    }
    setHover({
      x,
      y: concurrentTop,
      title: 'Cameras active',
      subtitle: `${formatShortDate(cursorDayMs)} · ${count} of ${data.sites.length}`,
    });
  };

  // Pixel width of one heatmap cell, capped at 1 so a sub-pixel range
  // does not collapse the whole row to a single line.
  const cellWidthPx = Math.max(
    1,
    Math.floor(plotWidth * (cellSpanMs / Math.max(1, xMaxMs - xMinMs))),
  );

  return (
    <div ref={containerRef} className="w-full overflow-x-hidden">
      <svg
        width={width}
        height={totalHeight}
        role="img"
        aria-label="Timeline"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setDrag(null)}
        style={{ cursor: drag ? 'ew-resize' : 'crosshair' }}
      >
        {ticks.map((t, i) => {
          const x = xToPx(t.ms);
          if (x < plotLeft || x > plotLeft + plotWidth) return null;
          return (
            <g key={t.ms}>
              <line
                x1={x}
                x2={x}
                y1={TOP_PADDING + AXIS_HEIGHT}
                y2={concurrentBottom}
                stroke={GRID_STROKE}
              />
              {tickKeep.has(i) && (
                <text
                  x={x}
                  y={TOP_PADDING + AXIS_HEIGHT - 8}
                  fontSize={11}
                  textAnchor="middle"
                  fill={AXIS_TEXT}
                  fontWeight={t.major ? 600 : 400}
                >
                  {t.label}
                </text>
              )}
            </g>
          );
        })}

        {data.sites.map((site, rowIdx) => {
          const rowTop =
            TOP_PADDING + AXIS_HEIGHT + rowIdx * (cfg.rowHeight + cfg.rowGap);
          const barY = rowTop + (cfg.rowHeight - cfg.barHeight) / 2;
          const cameraId = site.site_id !== null ? Number(site.site_id) : -1;
          const heatmap = heatmapByCamera.get(cameraId);
          const transitions = transitionsByCamera.get(cameraId) ?? [];
          const dotColor = STATUS_COLORS[site.camera_status] ?? '#9ca3af';
          const labelText = site.site_name.length > 24
            ? site.site_name.slice(0, 23) + '…'
            : site.site_name;

          return (
            <g key={site.site_id ?? rowIdx}>
              {/* Status dot prefix. Always rendered so the row aligns with
                  the camera id even in compact mode where the label hides. */}
              <circle
                cx={plotLeft - STATUS_DOT_GAP - (cfg.showLabels ? 0 : 6)}
                cy={rowTop + cfg.rowHeight / 2}
                r={cfg.showLabels ? 4 : 3}
                fill={dotColor}
              >
                <title>{`${site.site_name} · ${labelForStatus(site.camera_status)}`}</title>
              </circle>
              {cfg.showLabels && (
                <text
                  x={plotLeft - STATUS_DOT_GAP - 10}
                  y={rowTop + cfg.rowHeight / 2 + 4}
                  fontSize={12}
                  textAnchor="end"
                  fill={AXIS_TEXT}
                >
                  {labelText}
                </text>
              )}

              {/* Per-camera image-observed segments. Each segment runs
                  from the start-of-day of `iv.start` to the start-of-day
                  AFTER `iv.end`, so a single day always fills a full day
                  width and never collapses into a thin line. */}
              {viewMode === 'deployment' &&
                site.intervals.map((iv, i) => {
                  const ivStartMs = parseDate(iv.start);
                  const ivEndMs = parseDate(iv.end);
                  const ix = xToPx(ivStartMs);
                  const iw = Math.max(1, xToPx(ivEndMs + MS_PER_DAY) - ix);
                  return (
                    <rect
                      key={i}
                      x={ix}
                      y={barY}
                      width={iw}
                      height={cfg.barHeight}
                      fill={BAR_INNER}
                      rx={2}
                      onMouseEnter={() =>
                        setHover({
                          x: ix + iw / 2,
                          y: barY,
                          title: site.site_name,
                          subtitle:
                            `${formatShortDate(ivStartMs)} – ${formatShortDate(ivEndMs)}` +
                            ` · ${iv.trap_nights} day${iv.trap_nights === 1 ? '' : 's'} with signal`,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}

              {/* Heatmap mode still needs a faint guideline per CDP so
                  empty days are visible behind the cells. Same start-of-
                  next-day rule as the bars. */}
              {viewMode === 'heatmap' &&
                site.deployments.map((dep) => {
                  const startMs = parseDate(dep.configured_start);
                  const endMs = parseDate(dep.effective_end) + MS_PER_DAY;
                  const x = xToPx(startMs);
                  const w = Math.max(1, xToPx(endMs) - x);
                  return (
                    <rect
                      key={dep.deployment_id}
                      x={x}
                      y={barY}
                      width={w}
                      height={cfg.barHeight}
                      fill={BAR_OUTER_HEATMAP}
                      rx={2}
                    />
                  );
                })}

              {/* Heatmap cells, drawn on top of the outer guideline. */}
              {viewMode === 'heatmap' && heatmap &&
                Array.from(heatmap.cellsByMs.entries()).map(([cellMs, count]) => {
                  const fill = heatmapFill(count);
                  if (!fill) return null;
                  const cx = xToPx(cellMs);
                  if (cx + cellWidthPx < plotLeft || cx > plotLeft + plotWidth) return null;
                  return (
                    <rect
                      key={cellMs}
                      x={cx}
                      y={barY}
                      width={cellWidthPx}
                      height={cfg.barHeight}
                      fill={fill}
                      onMouseEnter={() =>
                        setHover({
                          x: cx + cellWidthPx / 2,
                          y: barY,
                          title: `${site.site_name}`,
                          subtitle: heatmapCellTooltip(cellMs, count, useWeeklyBins),
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}

              {/* CDP transition ticks. Vertical mark on the boundary day. */}
              {transitions.map((t) => {
                const tx = xToPx(parseDate(t.transition_date));
                if (tx < plotLeft || tx > plotLeft + plotWidth) return null;
                return (
                  <line
                    key={t.transition_date}
                    x1={tx}
                    x2={tx}
                    y1={rowTop + 1}
                    y2={rowTop + cfg.rowHeight - 1}
                    stroke={TRANSITION_STROKE}
                    strokeWidth={1.25}
                    strokeDasharray="2 1"
                    onMouseEnter={() =>
                      setHover({
                        x: tx,
                        y: rowTop,
                        title: site.site_name,
                        subtitle: `Camera moved more than 100 m on ${formatShortDate(parseDate(t.transition_date))}`,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
          );
        })}

        <line
          x1={plotLeft}
          x2={plotLeft + plotWidth}
          y1={concurrentBottom}
          y2={concurrentBottom}
          stroke={GRID_STROKE}
        />
        {concurrentPath && (
          <path d={concurrentPath} fill={CONCURRENT_FILL} stroke={CONCURRENT_STROKE} strokeWidth={1.25} />
        )}
        <text
          x={plotLeft - 8}
          y={concurrentTop + 12}
          fontSize={10}
          textAnchor="end"
          fill={AXIS_TEXT}
        >
          {concurrentMax}
        </text>
        <text
          x={plotLeft - 8}
          y={concurrentBottom - 2}
          fontSize={10}
          textAnchor="end"
          fill={AXIS_TEXT}
        >
          0
        </text>
        <text
          x={plotLeft - CONCURRENT_Y_LABEL_WIDTH - 6}
          y={(concurrentTop + concurrentBottom) / 2}
          fontSize={10}
          textAnchor="middle"
          fill={AXIS_TEXT}
          transform={`rotate(-90 ${plotLeft - CONCURRENT_Y_LABEL_WIDTH - 6} ${(concurrentTop + concurrentBottom) / 2})`}
        >
          Cameras active
        </text>

        {/* Concurrent-strip hover capture. Transparent so it does not
            paint, sits above the area chart, fires onMouseMove to
            populate the shared tooltip with the day's count. */}
        <rect
          x={plotLeft}
          y={concurrentTop}
          width={plotWidth}
          height={CONCURRENT_HEIGHT}
          fill="transparent"
          onMouseMove={handleConcurrentMove}
          onMouseLeave={() => setHover(null)}
        />
        {/* Dim overlay during drag, purely visual. pointerEvents="none"
            so it never swallows hover events on cells / bars / ticks. */}
        {drag && (
          <rect
            x={plotLeft}
            y={TOP_PADDING + AXIS_HEIGHT}
            width={plotWidth}
            height={rowsHeight + SECTION_GAP + CONCURRENT_HEIGHT}
            fill={HOVER_FILL}
            pointerEvents="none"
          />
        )}
        {drag && (
          <rect
            x={Math.min(drag.startX, drag.currentX)}
            y={TOP_PADDING + AXIS_HEIGHT}
            width={Math.abs(drag.currentX - drag.startX)}
            height={rowsHeight + SECTION_GAP + CONCURRENT_HEIGHT}
            fill="rgba(15, 96, 100, 0.10)"
            stroke="rgba(15, 96, 100, 0.5)"
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-card text-card-foreground px-2 py-1.5 text-xs shadow-md whitespace-nowrap"
          style={{
            left: hover.x,
            top: hover.y,
            transform: 'translate(-50%, calc(-100% - 10px))',
          }}
        >
          <div className="font-semibold">{hover.title}</div>
          <div className="text-muted-foreground">{hover.subtitle}</div>
        </div>
      )}
    </div>
  );
}

function labelForStatus(status: string): string {
  if (status === 'active') return 'Active';
  if (status === 'inactive') return 'Inactive';
  if (status === 'never_reported') return 'Never reported';
  return status;
}

function heatmapCellTooltip(cellMs: number, count: number, weekly: boolean): string {
  if (weekly) {
    const end = cellMs + 6 * MS_PER_DAY;
    return `${formatShortDate(cellMs)} – ${formatShortDate(end)} · ${count.toLocaleString()} images`;
  }
  return `${formatShortDate(cellMs)} · ${count.toLocaleString()} image${count === 1 ? '' : 's'}`;
}

function buildHeatmapIndex(
  rows: HeatmapPoint[],
  weekly: boolean,
): Map<number, CameraHeatmap> {
  const out = new Map<number, CameraHeatmap>();
  for (const row of rows) {
    const ms = parseDate(row.date);
    const bucketMs = weekly ? mondayUtc(ms) : ms;
    let entry = out.get(row.camera_id);
    if (!entry) {
      entry = { cellsByMs: new Map() };
      out.set(row.camera_id, entry);
    }
    entry.cellsByMs.set(bucketMs, (entry.cellsByMs.get(bucketMs) ?? 0) + row.count);
  }
  return out;
}

function mondayUtc(ms: number): number {
  const d = new Date(ms);
  const dow = d.getUTCDay();
  // JS getUTCDay() returns Sunday=0..Saturday=6. Shift so Monday=0.
  const offset = (dow + 6) % 7;
  return ms - offset * MS_PER_DAY;
}

function groupTransitionsByCamera(
  transitions: CdpTransition[],
): Map<number, CdpTransition[]> {
  const out = new Map<number, CdpTransition[]>();
  for (const t of transitions) {
    const list = out.get(t.camera_id);
    if (list) list.push(t);
    else out.set(t.camera_id, [t]);
  }
  return out;
}
