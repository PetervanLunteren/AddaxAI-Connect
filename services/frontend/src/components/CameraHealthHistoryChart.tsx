/**
 * Camera Health History Chart
 *
 * Shows historical health metrics (battery, signal, SD, images) as line charts.
 * Includes metric selector and time range selector (7/30/90 days or custom).
 */
import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
} from 'chart.js';
import type { ChartData } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Select, SelectItem } from './ui/Select';
import { camerasApi } from '../api/cameras';
import type { HealthReportPoint } from '../api/types';
import { formatDate, formatDateShort } from '../utils/datetime';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, annotationPlugin);

// Walk every date between `from` and `to` inclusive in UTC and emit the
// "YYYY-MM-DD" key. Used to dense-fill the chart so days without a daily
// report still render an x-axis tick (with no point or line, since the
// tooltip and dataset null entries make the gap visible).
function denseDateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(from);
  const end = new Date(to);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const SIGNAL_QUALITY_BANDS = [
  { label: 'Excellent', yMin: 20, yMax: 31, color: 'rgba(15, 96, 100, 0.10)' },
  { label: 'Good', yMin: 15, yMax: 20, color: 'rgba(113, 183, 186, 0.10)' },
  { label: 'Fair', yMin: 10, yMax: 15, color: 'rgba(255, 137, 69, 0.10)' },
  { label: 'Poor', yMin: 2, yMax: 10, color: 'rgba(136, 32, 0, 0.10)' },
  { label: 'No signal', yMin: 0, yMax: 2, color: 'rgba(136, 32, 0, 0.20)' },
] as const;

interface CameraHealthHistoryChartProps {
  cameraId: number;
}

type TimeRange = '7' | '30' | '90' | 'custom';
type Metric = 'battery' | 'signal' | 'sd' | 'total' | 'sent';

const METRIC_CONFIG: Record<Metric, {
  label: string;
  field: keyof HealthReportPoint;
  color: string;
  unit: string;
  min?: number;
  max?: number;
}> = {
  battery: {
    label: 'Battery',
    field: 'battery_percent',
    color: '#0f6064',
    unit: '%',
    min: 0,
    max: 100,
  },
  signal: {
    label: 'Signal quality',
    field: 'signal_quality',
    color: '#ff8945',
    unit: ' CSQ',
    min: 0,
    max: 31,
  },
  sd: {
    label: 'SD used',
    field: 'sd_utilization_percent',
    color: '#71b7ba',
    unit: '%',
    min: 0,
    max: 100,
  },
  total: {
    label: 'Total images',
    field: 'total_images',
    color: '#4a6741',
    unit: '',
    min: 0,
  },
  sent: {
    label: 'Images sent',
    field: 'sent_images',
    color: '#882000',
    unit: '',
    min: 0,
  },
};

export const CameraHealthHistoryChart: React.FC<CameraHealthHistoryChartProps> = ({ cameraId }) => {
  const [timeRange, setTimeRange] = useState<TimeRange>('30');
  const [selectedMetric, setSelectedMetric] = useState<Metric>('battery');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');

  // Build query filters
  const filters = useMemo(() => {
    if (timeRange === 'custom' && customStartDate && customEndDate) {
      return { start_date: customStartDate, end_date: customEndDate };
    }
    return { days: parseInt(timeRange) };
  }, [timeRange, customStartDate, customEndDate]);

  // Fetch health history
  const { data, isLoading, error } = useQuery({
    queryKey: ['camera-health-history', cameraId, filters],
    queryFn: () => camerasApi.getHealthHistory(cameraId, filters),
    enabled: timeRange !== 'custom' || (!!customStartDate && !!customEndDate),
  });

  const config = METRIC_CONFIG[selectedMetric];

  // Build a dense date list across the active range and merge observed
  // reports onto it. Days with no report carry a null value, which makes
  // chart.js break the line and skip the marker at that x position. The
  // axis tick still renders, so missing days remain visible.
  const dense = useMemo(() => {
    let fromDate: string;
    let toDate: string;
    if (timeRange === 'custom') {
      if (!customStartDate || !customEndDate) return [];
      fromDate = customStartDate;
      toDate = customEndDate;
    } else {
      const days = parseInt(timeRange, 10);
      const today = new Date();
      toDate = today.toISOString().slice(0, 10);
      today.setUTCDate(today.getUTCDate() - days);
      fromDate = today.toISOString().slice(0, 10);
    }

    const observed = new Map<string, HealthReportPoint>();
    data?.reports?.forEach((r) => observed.set(r.date, r));

    return denseDateRange(fromDate, toDate).map((date) => ({
      date,
      report: observed.get(date) ?? null,
    }));
  }, [data, timeRange, customStartDate, customEndDate]);

  // Prepare chart data
  const chartData: ChartData<'line'> = useMemo(() => {
    if (dense.length === 0) {
      return { labels: [], datasets: [] };
    }

    return {
      labels: dense.map((d) => formatDateShort(d.date)),
      datasets: [
        {
          label: config.label,
          data: dense.map((d) =>
            d.report ? (d.report[config.field] as number | null) : null,
          ),
          borderColor: config.color,
          backgroundColor: `${config.color}33`,
          tension: 0.3,
          fill: true,
          pointRadius: dense.length < 30 ? 3 : 0,
          pointHoverRadius: 5,
          spanGaps: false,
        },
      ],
    };
  }, [dense, config]);

  const signalAnnotations = selectedMetric === 'signal'
    ? Object.fromEntries(
        SIGNAL_QUALITY_BANDS.map((band) => [
          band.label,
          {
            type: 'box' as const,
            yMin: band.yMin,
            yMax: band.yMax,
            backgroundColor: band.color,
            borderWidth: 0,
            label: {
              display: true,
              content: band.label,
              position: { x: 'end' as const, y: 'center' as const },
              color: '#888',
              font: { size: 10 },
              padding: 2,
            },
          },
        ])
      )
    : {};

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.raw as number | null;
            if (value === null) return 'No data';
            return `${config.label}: ${value}${config.unit}`;
          },
        },
      },
      annotation: {
        annotations: signalAnnotations,
      },
    },
    scales: {
      y: {
        beginAtZero: config.min === 0,
        min: config.min,
        max: config.max,
        ticks: { precision: 0 },
        grid: { display: false },
      },
      x: {
        grid: { display: false },
      },
    },
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedMetric}
          onValueChange={(v) => setSelectedMetric(v as Metric)}
          className="w-36 h-9 text-sm"
        >
          <SelectItem value="battery">Battery</SelectItem>
          <SelectItem value="signal">Signal</SelectItem>
          <SelectItem value="sd">SD used</SelectItem>
          <SelectItem value="total">Total images</SelectItem>
          <SelectItem value="sent">Images sent</SelectItem>
        </Select>

        <Select
          value={timeRange}
          onValueChange={(v) => setTimeRange(v as TimeRange)}
          className="w-28 h-9 text-sm"
        >
          <SelectItem value="7">7 days</SelectItem>
          <SelectItem value="30">30 days</SelectItem>
          <SelectItem value="90">90 days</SelectItem>
          <SelectItem value="custom">Custom</SelectItem>
        </Select>

        {timeRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            />
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="h-64">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-destructive">Failed to load health history</p>
          </div>
        ) : data?.reports && data.reports.length > 0 ? (
          <Line data={chartData} options={chartOptions} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">No health data available for this period</p>
          </div>
        )}
      </div>

      {/* Summary stats */}
      {data?.reports && data.reports.length > 0 && dense.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {data.reports.length} report{data.reports.length !== 1 ? 's' : ''} across {dense.length} day{dense.length !== 1 ? 's' : ''}, from{' '}
          {formatDate(dense[0].date)} to {formatDate(dense[dense.length - 1].date)}
        </p>
      )}
    </div>
  );
};
