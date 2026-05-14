/**
 * Naive occupancy bar chart body. Proportion of active sites where each
 * species was detected at least once. "Naive" because it does not correct
 * for imperfect detection (MacKenzie et al. 2002). Paired with the
 * detection-history CSV export for unmarked / camtrapR analysis.
 *
 * Render-only: the page that hosts this component owns the header, the
 * download action, and the PlotExplainer. The chart returns the data-rich
 * caption (n active sites, date window) so callers can place it where they
 * want.
 */
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  ChartOptions,
} from 'chart.js';
import type { ChartData, Plugin } from 'chart.js';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel } from '../../utils/labels';
import type { NaiveOccupancyMetadata, NaiveOccupancyPoint } from '../../api/types';
import type { DateRange } from './DateRangeFilter';

// Plugin that draws a small vertical tick at each bar's corrected psi
// value (in percent). Skipped for species without a fitted psi. Reads
// the points array from the plugin options so the data passes through
// Chart.js's typings cleanly without coupling to dataset internals.
const correctedPsiMarkerPlugin: Plugin<'bar'> = {
  id: 'correctedPsiMarker',
  afterDatasetsDraw(chart, _args, options) {
    const opts = options as { points?: NaiveOccupancyPoint[] };
    const points = opts.points;
    if (!points) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;

    ctx.save();
    ctx.strokeStyle = '#0a3e41';
    ctx.lineWidth = 2;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.psi == null) continue;
      const bar = meta.data[i] as unknown as { y: number; height: number };
      if (!bar) continue;
      const x = xScale.getPixelForValue(p.psi * 100);
      if (x < chartArea.left || x > chartArea.right) continue;
      const half = (bar.height || 16) / 2 - 1;
      ctx.beginPath();
      ctx.moveTo(x, bar.y - half);
      ctx.lineTo(x, bar.y + half);
      ctx.stroke();
    }
    ctx.restore();
  },
};

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, correctedPsiMarkerPlugin);

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

interface NaiveOccupancyChartProps {
  dateRange: DateRange;
  projectId?: number;
  cameraIds?: string;
  /** How many species to render. null = all species. */
  topN: number | null;
  /** Called when the response metadata changes so the parent can render
   *  page-level info (e.g. window dates, detection threshold). */
  onMetadataChange?: (metadata: NaiveOccupancyMetadata | null) => void;
}

export const NaiveOccupancyChart: React.FC<NaiveOccupancyChartProps> = ({
  dateRange,
  projectId,
  cameraIds,
  topN,
  onMetadataChange,
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'naive-occupancy', projectId, dateRange.startDate, dateRange.endDate, cameraIds, topN],
    queryFn: () =>
      statisticsApi.getNaiveOccupancy(projectId, {
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        camera_ids: cameraIds,
        top_n: topN === null ? undefined : topN,
      }),
    enabled: projectId !== undefined,
  });

  const points = data?.points ?? [];
  const meta = data?.metadata ?? null;

  React.useEffect(() => {
    if (onMetadataChange) onMetadataChange(meta);
  }, [meta, onMetadataChange]);

  const chartData: ChartData<'bar'> = useMemo(() => {
    return {
      labels: points.map((p) => normalizeLabel(p.species)),
      datasets: [
        {
          label: 'Naive occupancy',
          data: points.map((p) => +(p.proportion * 100).toFixed(1)),
          backgroundColor: '#0f6064',
          borderRadius: 4,
        },
      ],
    };
  }, [points]);

  const chartOptions: ChartOptions<'bar'> = useMemo(() => ({
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      // Single dataset with per-bar colours; a "Naive occupancy" legend
      // swatch is noise.
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const idx = context.dataIndex;
            const p = points[idx];
            if (!p) return '';
            const naive = `${p.sites_detected} of ${p.sites_total} active sites (${formatPct(p.proportion)}), uncorrected for detection`;
            if (p.psi == null) return naive;
            const ci =
              p.psi_ci_low != null && p.psi_ci_high != null
                ? ` (95% CI ${formatPct(p.psi_ci_low)} - ${formatPct(p.psi_ci_high)})`
                : '';
            return [naive, `Corrected: ${formatPct(p.psi)}${ci}`];
          },
        },
      },
      // @ts-expect-error custom plugin options aren't in Chart.js's typings
      correctedPsiMarker: { points },
    },
    scales: {
      x: {
        beginAtZero: true,
        max: 100,
        ticks: {
          callback: (value) => `${value}%`,
        },
        title: {
          display: true,
          text: 'Proportion of active sites where species detected',
        },
      },
      y: {
        grid: {
          display: false,
        },
        ticks: {
          callback: function (_value, index) {
            const p = points[index];
            if (!p) return '';
            return `${normalizeLabel(p.species)}  (${p.sites_detected}/${p.sites_total})`;
          },
        },
      },
    },
  }), [points]);

  return (
    <div style={{ height: Math.max(240, points.length * 28 + 80) }}>
      {isLoading ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : points.length > 0 ? (
        <Bar data={chartData} options={chartOptions} />
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">
            {meta?.sites_total === 0
              ? 'No active sites in this window'
              : 'No species detected in this window'}
          </p>
        </div>
      )}
    </div>
  );
};
