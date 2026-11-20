/**
 * The time axis shared by the two timelines: the Insights timeline (rows per
 * site, photo activity) and the Deployments page (one bar per deployment).
 * Dates, month ticks, the chart width, drag to zoom, the axis, the drag
 * overlay and the tooltip live here once, so the two charts never drift.
 *
 * Days are YYYY-MM-DD strings read as UTC midnight, so a day never shifts
 * with the browser's timezone. A day fills the width from its start to the
 * start of the next day.
 */
import { useEffect, useRef, useState } from 'react';

export const MS_PER_DAY = 86_400_000;

export const GRID_STROKE = 'rgba(0, 0, 0, 0.06)';
export const AXIS_TEXT = 'rgba(0, 0, 0, 0.65)';
const HOVER_FILL = 'rgba(0, 0, 0, 0.05)';

export function parseDate(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatYMD(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface MonthTick {
  ms: number;
  label: string;
  major: boolean;
}

export function generateMonthTicks(xMinMs: number, xMaxMs: number): MonthTick[] {
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

/** Which ticks keep their label: at least 56 px apart, years always. */
export function thinTicks(ticks: MonthTick[], plotWidth: number): Set<number> {
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

/** The domain from a first and last day (both included), with 2% padding. */
export function paddedDomain(fromMs: number, toMs: number): { xMinMs: number; xMaxMs: number } {
  const hi = toMs + MS_PER_DAY;
  const span = Math.max(MS_PER_DAY, hi - fromMs);
  const pad = span * 0.02;
  return { xMinMs: fromMs - pad, xMaxMs: hi + pad };
}

/** The scale from time to pixels and back. */
export function timeScale(xMinMs: number, xMaxMs: number, plotLeft: number, plotWidth: number) {
  const span = Math.max(1, xMaxMs - xMinMs);
  return {
    xToPx: (ms: number) => plotLeft + ((ms - xMinMs) / span) * plotWidth,
    pxToMs: (px: number) => xMinMs + ((px - plotLeft) / Math.max(1, plotWidth)) * span,
  };
}

/**
 * The drawn width of a chart: the container's width, never less than
 * `minWidth`. Below that the year ticks overlap, so narrow screens scroll
 * the chart instead.
 */
export function useChartWidth(minWidth = 800) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(minWidth, Math.floor(e.contentRect.width)));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [minWidth]);
  return { containerRef, width };
}

/** The x of a mouse event inside its svg. */
export function xFromEvent(e: React.MouseEvent): number {
  const svg = (e.currentTarget as Element).closest('svg') as SVGSVGElement | null;
  const rect = (svg ?? (e.currentTarget as SVGSVGElement)).getBoundingClientRect();
  return e.clientX - rect.left;
}

const ZOOM_DRAG_THRESHOLD_PX = 4;

export interface DragState {
  startX: number;
  currentX: number;
}

/**
 * Drag on the plot to zoom. Calls onZoom with YYYY-MM-DD strings. A press
 * that moves less than a few pixels is a click, not a zoom, so clicks on
 * the marks inside still work.
 */
export function useDragZoom({
  plotLeft,
  plotWidth,
  xMinMs,
  xMaxMs,
  pxToMs,
  onZoom,
}: {
  plotLeft: number;
  plotWidth: number;
  xMinMs: number;
  xMaxMs: number;
  pxToMs: (px: number) => number;
  onZoom?: (from: string, to: string) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const handlers = {
    onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => {
      const x = xFromEvent(e);
      if (x < plotLeft || x > plotLeft + plotWidth) return;
      setDrag({ startX: x, currentX: x });
    },
    onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => {
      if (!drag) return;
      setDrag({ ...drag, currentX: xFromEvent(e) });
    },
    onMouseUp: (e: React.MouseEvent<SVGSVGElement>) => {
      if (!drag) return;
      const x = xFromEvent(e);
      if (Math.abs(x - drag.startX) >= ZOOM_DRAG_THRESHOLD_PX && onZoom) {
        const a = Math.min(drag.startX, x);
        const b = Math.max(drag.startX, x);
        onZoom(formatYMD(Math.max(xMinMs, pxToMs(a))), formatYMD(Math.min(xMaxMs, pxToMs(b))));
      }
      setDrag(null);
    },
    onMouseLeave: () => setDrag(null),
  };
  return { drag, handlers };
}

/** Month grid lines from `top` to `bottom`, with the labels above `top`. */
export function TimeAxis({
  ticks,
  keep,
  xToPx,
  plotLeft,
  plotWidth,
  top,
  bottom,
  labelY,
}: {
  ticks: MonthTick[];
  keep: Set<number>;
  xToPx: (ms: number) => number;
  plotLeft: number;
  plotWidth: number;
  top: number;
  bottom: number;
  labelY: number;
}) {
  return (
    <>
      {ticks.map((t, i) => {
        const x = xToPx(t.ms);
        if (x < plotLeft || x > plotLeft + plotWidth) return null;
        return (
          <g key={t.ms}>
            <line x1={x} x2={x} y1={top} y2={bottom} stroke={GRID_STROKE} />
            {keep.has(i) && (
              <text
                x={x}
                y={labelY}
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
    </>
  );
}

/** The dim layer and the selected band while dragging. Never takes events. */
export function DragOverlay({
  drag,
  plotLeft,
  plotWidth,
  top,
  height,
}: {
  drag: DragState | null;
  plotLeft: number;
  plotWidth: number;
  top: number;
  height: number;
}) {
  if (!drag) return null;
  return (
    <>
      <rect x={plotLeft} y={top} width={plotWidth} height={height} fill={HOVER_FILL} pointerEvents="none" />
      <rect
        x={Math.min(drag.startX, drag.currentX)}
        y={top}
        width={Math.abs(drag.currentX - drag.startX)}
        height={height}
        fill="rgba(15, 96, 100, 0.10)"
        stroke="rgba(15, 96, 100, 0.5)"
        strokeDasharray="3 3"
        pointerEvents="none"
      />
    </>
  );
}

export interface HoverInfo {
  x: number;
  y: number;
  title: string;
  subtitle: string;
}

/** The tooltip over a mark. The chart's wrapper must be `relative`. */
export function ChartTooltip({ hover }: { hover: HoverInfo | null }) {
  if (!hover) return null;
  return (
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
  );
}
