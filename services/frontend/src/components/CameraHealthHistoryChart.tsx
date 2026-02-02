/**
 * Camera Health History Chart
 *
 * Shows historical health metrics (battery, signal, temperature, SD) as line charts.
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
import { Select, SelectItem } from './ui/Select';
import { camerasApi } from '../api/cameras';
import type { HealthReportPoint } from '../api/types';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface CameraHealthHistoryChartProps {
  cameraId: number;
}

type TimeRange = '7' | '30' | '90' | 'custom';
type Metric = 'battery' | 'signal' | 'temperature' | 'sd' | 'images';

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
    color: '#71b7ba',
    unit: ' CSQ',
    min: 0,
    max: 31,
  },
  temperature: {
    label: 'Temperature',
    field: 'temperature_c',
    color: '#e07b39',
    unit: '°C',
  },
  sd: {
    label: 'SD utilization',
    field: 'sd_utilization_percent',
    color: '#8b5cf6',
    unit: '%',
    min: 0,
    max: 100,
  },
  images: {
    label: 'Images on SD',
    field: 'total_images',
    color: '#0ea5e9',
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

  // Prepare chart data
  const chartData: ChartData<'line'> = useMemo(() => {
    if (!data?.reports) {
      return { labels: [], datasets: [] };
    }

    return {
      labels: data.reports.map((r) =>
        new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      ),
      datasets: [
        {
          label: config.label,
          data: data.reports.map((r) => r[config.field] as number | null),
          borderColor: config.color,
          backgroundColor: `${config.color}33`,
          tension: 0.3,
          fill: true,
          pointRadius: data.reports.length < 30 ? 3 : 0,
          pointHoverRadius: 5,
        },
      ],
    };
  }, [data, config]);

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
    },
    scales: {
      y: {
        beginAtZero: config.min === 0,
        min: config.min,
        max: config.max,
        ticks: { precision: 0 },
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
          <SelectItem value="temperature">Temperature</SelectItem>
          <SelectItem value="sd">SD card</SelectItem>
          <SelectItem value="images">Images on SD</SelectItem>
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
      {data?.reports && data.reports.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {data.reports.length} report{data.reports.length !== 1 ? 's' : ''} from{' '}
          {new Date(data.reports[0].date).toLocaleDateString()} to{' '}
          {new Date(data.reports[data.reports.length - 1].date).toLocaleDateString()}
        </p>
      )}
    </div>
  );
};
