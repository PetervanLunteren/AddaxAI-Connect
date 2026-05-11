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
import type { ChartData } from 'chart.js';
import { statisticsApi } from '../../api/statistics';
import { getSpeciesColor } from '../../utils/species-colors';
import { normalizeLabel } from '../../utils/labels';
import type { NaiveOccupancyMetadata } from '../../api/types';
import type { DateRange } from './DateRangeFilter';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface NaiveOccupancyChartProps {
  dateRange: DateRange;
  projectId?: number;
  cameraIds?: string;
  /** Called when the response metadata changes so the parent can render
   *  page-level info (e.g. window dates, detection threshold). */
  onMetadataChange?: (metadata: NaiveOccupancyMetadata | null) => void;
}

export const NaiveOccupancyChart: React.FC<NaiveOccupancyChartProps> = ({
  dateRange,
  projectId,
  cameraIds,
  onMetadataChange,
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'naive-occupancy', projectId, dateRange.startDate, dateRange.endDate, cameraIds],
    queryFn: () =>
      statisticsApi.getNaiveOccupancy(projectId, {
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        camera_ids: cameraIds,
        top_n: 15,
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
          backgroundColor: points.map((p) => getSpeciesColor(p.species)),
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
      tooltip: {
        callbacks: {
          label: (context) => {
            const idx = context.dataIndex;
            const p = points[idx];
            if (!p) return '';
            const pct = (p.proportion * 100).toFixed(1);
            return `${p.sites_detected} of ${p.sites_total} active sites (${pct}%), uncorrected for detection`;
          },
        },
      },
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
