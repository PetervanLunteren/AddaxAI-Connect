/**
 * Deployment timeline chart — row-per-camera Gantt + concurrent-cameras strip.
 *
 * One `<svg>` hosts three regions stacked vertically:
 *   - Top: x-axis with month / year ticks.
 *   - Middle: one row per camera, light-teal outer bar per deployment,
 *             solid teal bar per trap-night interval clipped to the window.
 *   - Bottom: step-function area chart of concurrent active cameras.
 *
 * Drag-to-zoom on the chart writes back into the parent's date filter.
 *
 * Adapted from AddaxAI WebUI's DeploymentTimelineChart. Connect has no
 * subfolder concept, so each deployment renders as a single bar (no
 * multi-track stacking inside a row).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimelineResponse } from '../../api/types';

const BAR_INNER = '#0f6064';
const BAR_OUTER = 'rgba(15, 96, 100, 0.18)';
const CONCURRENT_FILL = 'rgba(15, 96, 100, 0.18)';
const CONCURRENT_STROKE = '#0f6064';
const GRID_STROKE = 'rgba(0, 0, 0, 0.06)';
const AXIS_TEXT = 'rgba(0, 0, 0, 0.65)';
const HOVER_FILL = 'rgba(0, 0, 0, 0.05)';

type Density = 'normal' | 'compact';

interface DensityConfig {
  rowHeight: number;
  rowGap: number;
  barHeight: number;
  labelWidth: number;
  showLabels: boolean;
}

const DENSITY: Record<Density, DensityConfig> = {
  normal: { rowHeight: 24, rowGap: 4, barHeight: 14, labelWidth: 160, showLabels: true },
  compact: { rowHeight: 8, rowGap: 1, barHeight: 6, labelWidth: 24, showLabels: false },
};

const CONCURRENT_HEIGHT = 70;
const AXIS_HEIGHT = 28;
const RIGHT_PADDING = 16;
const TOP_PADDING = 4;
const SECTION_GAP = 14;
const CONCURRENT_Y_LABEL_WIDTH = 28;

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

export function DeploymentTimelineChart({
  data,
  density = 'normal',
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

  // Compute x-axis bounds. Fall back to the first/last deployment dates if
  // the metadata fields are missing (defensive).
  const { xMinMs, xMaxMs } = useMemo(() => {
    let lo = data.date_range_from ? parseDate(data.date_range_from) : Infinity;
    let hi = data.date_range_to ? parseDate(data.date_range_to) : -Infinity;
    for (const site of data.sites) {
      for (const dep of site.deployments) {
        lo = Math.min(lo, parseDate(dep.configured_start));
        const end = dep.configured_end ?? data.date_range_to;
        if (end) hi = Math.max(hi, parseDate(end));
        for (const iv of dep.intervals) {
          lo = Math.min(lo, parseDate(iv.start));
          hi = Math.max(hi, parseDate(iv.end));
        }
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) {
      const today = Date.now();
      lo = today - 30 * MS_PER_DAY;
      hi = today;
    }
    // Pad by 2% on each side so bars don't touch the chart edges.
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

  const concurrentMax = useMemo(
    () => Math.max(1, data.metrics.max_concurrent_cameras),
    [data],
  );
  const concurrentTop = TOP_PADDING + AXIS_HEIGHT + rowsHeight + SECTION_GAP;
  const concurrentBottom = concurrentTop + CONCURRENT_HEIGHT;
  const concurrentYToPx = (count: number) =>
    concurrentBottom - (count / concurrentMax) * CONCURRENT_HEIGHT;

  // Build the area-chart polyline as a step function, with the
  // bottom-anchored points so the polygon fills underneath cleanly.
  const concurrentPath = useMemo(() => {
    const pts = data.concurrent_cameras;
    if (pts.length === 0) return '';
    const parts: string[] = [];
    parts.push(`M ${xToPx(parseDate(pts[0].date))} ${concurrentBottom}`);
    let prevX = xToPx(parseDate(pts[0].date));
    let prevY = concurrentYToPx(pts[0].count);
    parts.push(`L ${prevX} ${prevY}`);
    for (let i = 1; i < pts.length; i++) {
      const nextX = xToPx(parseDate(pts[i].date));
      const nextY = concurrentYToPx(pts[i].count);
      parts.push(`L ${nextX} ${prevY}`);  // step right
      parts.push(`L ${nextX} ${nextY}`);  // step down/up
      prevX = nextX;
      prevY = nextY;
    }
    parts.push(`L ${prevX} ${concurrentBottom}`);
    parts.push('Z');
    return parts.join(' ');
  }, [data, xMinMs, xMaxMs, plotWidth]);

  const handleMouseDown = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < plotLeft || x > plotLeft + plotWidth) return;
    setDrag({ startX: x, currentX: x });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!drag) return;
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    setDrag({ ...drag, currentX: x });
  };

  const handleMouseUp = (e: React.MouseEvent<SVGRectElement>) => {
    if (!drag) return;
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
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

  return (
    <div ref={containerRef} className="w-full overflow-x-hidden">
      <svg width={width} height={totalHeight} role="img" aria-label="Deployment timeline">
        {/* Month ticks + grid lines */}
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

        {/* Per-camera rows */}
        {data.sites.map((site, rowIdx) => {
          const rowTop =
            TOP_PADDING + AXIS_HEIGHT + rowIdx * (cfg.rowHeight + cfg.rowGap);
          const barY = rowTop + (cfg.rowHeight - cfg.barHeight) / 2;
          return (
            <g key={site.site_id ?? rowIdx}>
              {cfg.showLabels && (
                <text
                  x={plotLeft - 8}
                  y={rowTop + cfg.rowHeight / 2 + 4}
                  fontSize={12}
                  textAnchor="end"
                  fill={AXIS_TEXT}
                >
                  {site.site_name.length > 22 ? site.site_name.slice(0, 21) + '…' : site.site_name}
                </text>
              )}
              {site.deployments.map((dep) => {
                const startMs = parseDate(dep.configured_start);
                const endMs = parseDate(dep.configured_end ?? formatYMD(xMaxMs));
                const x = xToPx(startMs);
                const w = Math.max(1, xToPx(endMs) - x);
                return (
                  <g key={dep.deployment_id}>
                    {/* Outer light bar: the configured deployment window */}
                    <rect
                      x={x}
                      y={barY}
                      width={w}
                      height={cfg.barHeight}
                      fill={BAR_OUTER}
                      rx={2}
                      onMouseEnter={() =>
                        setHover({
                          x: x + w / 2,
                          y: barY,
                          title: `${site.site_name} • ${dep.deployment_label}`,
                          subtitle:
                            `${formatShortDate(startMs)} – ` +
                            `${dep.configured_end ? formatShortDate(endMs) : 'active'}` +
                            ` • ${dep.file_count.toLocaleString()} images`,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                    />
                    {/* Inner solid bars: the trap-night intervals after clipping */}
                    {dep.intervals.map((iv, i) => {
                      const ivStart = parseDate(iv.start);
                      const ivEnd = parseDate(iv.end);
                      const ix = xToPx(ivStart);
                      const iw = Math.max(1, xToPx(ivEnd) - ix);
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
                              title: `${site.site_name} • ${dep.deployment_label}`,
                              subtitle:
                                `${formatShortDate(ivStart)} – ${formatShortDate(ivEnd)}` +
                                ` • ${iv.trap_nights} trap-night${iv.trap_nights === 1 ? '' : 's'}`,
                            })
                          }
                          onMouseLeave={() => setHover(null)}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Concurrent-cameras strip */}
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
        {/* y-axis label for the concurrent strip */}
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
          Concurrent
        </text>

        {/* Drag-zoom overlay */}
        <rect
          x={plotLeft}
          y={TOP_PADDING + AXIS_HEIGHT}
          width={plotWidth}
          height={rowsHeight + SECTION_GAP + CONCURRENT_HEIGHT}
          fill={drag ? HOVER_FILL : 'transparent'}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setDrag(null)}
          style={{ cursor: drag ? 'ew-resize' : 'crosshair' }}
        />
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

      {/* Tooltip (rendered outside the SVG so it can use full HTML / wrap) */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-md"
          style={{ left: hover.x + 8, top: hover.y - 4 }}
        >
          <div className="font-semibold">{hover.title}</div>
          <div className="text-muted-foreground">{hover.subtitle}</div>
        </div>
      )}
    </div>
  );
}
