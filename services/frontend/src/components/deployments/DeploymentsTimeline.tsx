/**
 * The timeline of the Deployments page: one row per camera or site, one bar
 * per deployment from its first day to its last (an open one to today).
 *
 * - The light bar is the deployment, the dark strip at its foot the days
 *   with photos, so gaps and silent cameras stand out.
 * - A fixed period (set by a person or an upload) has an outline.
 * - Orange marks are photos without a site.
 * - A click selects a bar, a drag zooms into the date filter.
 *
 * The axis, scale, drag and tooltip come from plots/timeline-scale, shared
 * with the Insights timeline.
 */
import { useMemo, useState } from 'react';
import {
  AXIS_TEXT,
  ChartTooltip,
  DragOverlay,
  MS_PER_DAY,
  TimeAxis,
  formatShortDate,
  generateMonthTicks,
  paddedDomain,
  parseDate,
  thinTicks,
  timeScale,
  useChartWidth,
  useDragZoom,
  type HoverInfo,
} from '../plots/timeline-scale';
import type { Bar, TimelineRow } from './deployment-rows';

const TEAL = '#0f6064';
const BAR_FILL = 'rgba(15, 96, 100, 0.16)';
const UNPLACED = '#ff8945';
const SELECTED = '#ff8945';

const LABEL_WIDTH = 150;
const LANE_HEIGHT = 22;
const BAR_HEIGHT = 18;
const PHOTO_STRIP = 4;
const ROW_GAP = 6;
const AXIS_HEIGHT = 28;
const TOP_PADDING = 4;
const RIGHT_PADDING = 16;
const LABEL_CHAR_PX = 6.5;

interface Props {
  rows: TimelineRow[];
  from: string; // first day drawn
  to: string; // last day drawn
  selectedId: number | null;
  onSelect: (bar: Bar) => void;
  onZoom: (from: string, to: string) => void;
}

const days = (a: string, b: string) => Math.round((parseDate(b) - parseDate(a)) / MS_PER_DAY) + 1;

export function DeploymentsTimeline({ rows, from, to, selectedId, onSelect, onZoom }: Props) {
  const { containerRef, width } = useChartWidth(640);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const { xMinMs, xMaxMs } = paddedDomain(parseDate(from), parseDate(to));
  const plotLeft = LABEL_WIDTH;
  const plotWidth = Math.max(40, width - plotLeft - RIGHT_PADDING);
  const { xToPx, pxToMs } = timeScale(xMinMs, xMaxMs, plotLeft, plotWidth);
  const { drag, handlers } = useDragZoom({ plotLeft, plotWidth, xMinMs, xMaxMs, pxToMs, onZoom });

  const ticks = useMemo(() => generateMonthTicks(xMinMs, xMaxMs), [xMinMs, xMaxMs]);
  const keep = useMemo(() => thinTicks(ticks, plotWidth), [ticks, plotWidth]);

  // Row tops, each row as high as its lanes.
  const rowsTop = TOP_PADDING + AXIS_HEIGHT;
  const tops: number[] = [];
  let y = rowsTop;
  for (const r of rows) {
    tops.push(y);
    y += r.lanes.length * LANE_HEIGHT + ROW_GAP;
  }
  const rowsBottom = y;

  const selectedCamera = rows
    .flatMap((r) => r.lanes.flat())
    .find((b) => b.id === selectedId)?.cameraId;

  // From the start of the first day to the start of the day after the last,
  // clipped to the plot: a bar that began before a zoomed range starts at
  // its left edge, never over the row labels.
  const span = (start: string, end: string) => {
    const x = Math.max(plotLeft, xToPx(parseDate(start)));
    const right = Math.min(plotLeft + plotWidth, xToPx(parseDate(end) + MS_PER_DAY));
    return { x, w: Math.max(1, right - x) };
  };

  const drawBar = (bar: Bar, laneTop: number) => {
    const { x, w } = span(bar.start, bar.end);
    const barY = laneTop + (LANE_HEIGHT - BAR_HEIGHT) / 2;
    const selected = bar.id === selectedId;
    const faded = selectedCamera !== undefined && bar.cameraId !== selectedCamera;
    const fits = bar.label.length * LABEL_CHAR_PX + 8 < w;
    const d = bar.deployment;
    const showTip = () =>
      setHover({
        x: x + w / 2,
        y: barY,
        title: `${d.camera_label ?? 'Camera'} at ${d.site_name ?? 'no site'}`,
        subtitle:
          `${formatShortDate(parseDate(bar.start))} to ${bar.open ? 'now' : formatShortDate(parseDate(bar.end))}` +
          ` · ${d.image_count.toLocaleString()} photos${bar.fixed ? ' · fixed' : ''}`,
      });
    return (
      <g
        key={bar.id}
        opacity={faded ? 0.3 : 1}
        style={{ cursor: 'pointer' }}
        onClick={() => onSelect(bar)}
        onMouseEnter={showTip}
        onMouseLeave={() => setHover(null)}
      >
        <rect
          x={x}
          y={barY}
          width={w}
          height={BAR_HEIGHT}
          rx={3}
          fill={BAR_FILL}
          stroke={selected ? SELECTED : bar.fixed ? TEAL : 'none'}
          strokeWidth={selected ? 2 : 1.25}
        />
        {bar.photoDays.map((s) => {
          const p = span(s.start, s.end);
          return (
            <rect
              key={s.start}
              x={p.x}
              y={barY + BAR_HEIGHT - PHOTO_STRIP}
              width={p.w}
              height={PHOTO_STRIP}
              fill={TEAL}
              pointerEvents="none"
            />
          );
        })}
        {fits && (
          <text
            x={x + 5}
            y={barY + BAR_HEIGHT - PHOTO_STRIP - 4}
            fontSize={11}
            fill={TEAL}
            pointerEvents="none"
          >
            {bar.label}
          </text>
        )}
      </g>
    );
  };

  return (
    <div ref={containerRef} className="relative w-full overflow-x-auto">
      <svg
        width={width}
        height={rowsBottom + 4}
        role="img"
        aria-label="Deployments timeline"
        {...handlers}
        style={{ cursor: drag ? 'ew-resize' : 'crosshair' }}
      >
        <TimeAxis
          ticks={ticks}
          keep={keep}
          xToPx={xToPx}
          plotLeft={plotLeft}
          plotWidth={plotWidth}
          top={rowsTop}
          bottom={rowsBottom}
          labelY={TOP_PADDING + AXIS_HEIGHT - 8}
        />
        {rows.map((row, i) => {
          const top = tops[i];
          const label = row.label.length > 22 ? row.label.slice(0, 21) + '…' : row.label;
          return (
            <g key={row.key}>
              <text x={plotLeft - 10} y={top + LANE_HEIGHT / 2 + 4} fontSize={12} textAnchor="end" fill={AXIS_TEXT}>
                <title>{row.label}</title>
                {label}
              </text>
              {row.lanes.map((lane, l) => lane.map((bar) => drawBar(bar, top + l * LANE_HEIGHT)))}
              {row.unplaced.map((s) => {
                const p = span(s.start, s.end);
                const n = days(s.start, s.end);
                return (
                  <rect
                    key={`u${s.start}`}
                    x={p.x}
                    y={top + (LANE_HEIGHT - BAR_HEIGHT) / 2}
                    width={p.w}
                    height={BAR_HEIGHT}
                    rx={2}
                    fill={UNPLACED}
                    onMouseEnter={() =>
                      setHover({
                        x: p.x + p.w / 2,
                        y: top,
                        title: 'Photos without a site',
                        subtitle:
                          n === 1
                            ? formatShortDate(parseDate(s.start))
                            : `${formatShortDate(parseDate(s.start))} to ${formatShortDate(parseDate(s.end))}`,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </g>
          );
        })}
        <DragOverlay drag={drag} plotLeft={plotLeft} plotWidth={plotWidth} top={rowsTop} height={rowsBottom - rowsTop} />
      </svg>
      <ChartTooltip hover={hover} />
    </div>
  );
}
