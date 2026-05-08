/**
 * Naive occupancy chart - proportion of active sites where each species was
 * detected at least once during the window. "Naive" because it does not
 * correct for imperfect detection (MacKenzie et al. 2002). Pair with the
 * detection-history CSV export for unmarked / camtrapR analysis.
 */
import React, { useMemo, useState } from 'react';
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
import { Info, Download } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { statisticsApi } from '../../api/statistics';
import { getSpeciesColor } from '../../utils/species-colors';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface NaiveOccupancyChartProps {
  dateRange: DateRange;
  projectId?: number;
  cameraIds?: string;
}

export const NaiveOccupancyChart: React.FC<NaiveOccupancyChartProps> = ({
  dateRange,
  projectId,
  cameraIds,
}) => {
  const [showInfo, setShowInfo] = useState(false);

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
  const meta = data?.metadata;

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
            return `${p.sites_detected} of ${p.sites_total} active sites (${pct}%) · uncorrected for detection`;
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
          // Append n/N to the label so small samples are visible.
          callback: function (value, index) {
            const p = points[index];
            if (!p) return '';
            return `${normalizeLabel(p.species)}  (${p.sites_detected}/${p.sites_total})`;
          },
        },
      },
    },
  }), [points]);

  const downloadDisabled = !projectId || !dateRange.startDate || !dateRange.endDate;
  const downloadUrl = (!downloadDisabled && projectId)
    ? statisticsApi.getDetectionHistoryCsvUrl(
        projectId,
        dateRange.startDate as string,
        dateRange.endDate as string,
        { cameraIds, occasionLengthDays: 1 },
      )
    : '#';

  const captionDateRange =
    meta?.window_start && meta?.window_end
      ? `${meta.window_start} – ${meta.window_end}`
      : '';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">Naive occupancy</CardTitle>
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="About this chart"
            >
              <Info className="h-4 w-4" />
            </button>
          </div>
          <a
            href={downloadDisabled ? undefined : downloadUrl}
            aria-disabled={downloadDisabled}
            onClick={(e) => downloadDisabled && e.preventDefault()}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={downloadDisabled}
              className="gap-1"
              title={downloadDisabled
                ? 'Pick an explicit date range to download the detection history'
                : 'Download sites × occasions detection history (CSV)'}
            >
              <Download className="h-4 w-4" />
              Detection history (CSV)
            </Button>
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          Sites where each species was detected at least once / total active sites in the window.
          {meta && (
            <> {' '}n={meta.sites_total} sites &middot; {captionDateRange} &middot; uncorrected for detection probability.</>
          )}
        </p>
        {showInfo && (
          <div className="mt-2 p-3 bg-muted text-sm rounded border border-border space-y-2">
            <p>
              Naive occupancy is the proportion of sampled sites where a species was detected at least
              once during the window. It is biased low when detection probability is below 1
              (MacKenzie et al. 2002). For estimated occupancy &psi;, use the detection-history CSV
              with R's <code>unmarked</code> or <code>camtrapR</code> packages.
            </p>
            <p className="text-muted-foreground">
              Site = camera. A camera is "active" in the window if any of its deployment periods
              overlaps the window. Person and vehicle detections are excluded. Independence interval
              is not applied to binary presence.
              {meta?.detection_threshold !== null && meta?.detection_threshold !== undefined && (
                <> Detection threshold {meta.detection_threshold}.</>
              )}
              {meta?.classification_threshold_default !== null && meta?.classification_threshold_default !== undefined && (
                <> Classification threshold default {meta.classification_threshold_default}.</>
              )}
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
};
