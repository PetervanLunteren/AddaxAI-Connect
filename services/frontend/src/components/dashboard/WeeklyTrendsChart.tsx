/**
 * Weekly Trends Chart - Bar chart showing activity grouped by week
 */
import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Select, SelectItem } from '../ui/Select';
import { statisticsApi } from '../../api/statistics';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface WeeklyTrendsChartProps {
  dateRange: DateRange;
}

type GroupBy = 'week' | 'month';

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const WeeklyTrendsChart: React.FC<WeeklyTrendsChartProps> = ({ dateRange }) => {
  const [groupBy, setGroupBy] = useState<GroupBy>('week');

  // Fetch detection trend data
  const { data: rawData, isLoading } = useQuery({
    queryKey: ['statistics', 'detection-trend', 'all', dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      statisticsApi.getDetectionTrend({
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
      }),
  });

  // Group data by week or month
  const groupedData = useMemo(() => {
    if (!rawData) return [];

    const groups = new Map<string, number>();

    rawData.forEach((point) => {
      const date = new Date(point.date);
      let key: string;

      if (groupBy === 'week') {
        const week = getWeekNumber(date);
        const year = date.getFullYear();
        key = `${year}-W${week.toString().padStart(2, '0')}`;
      } else {
        key = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      }

      groups.set(key, (groups.get(key) ?? 0) + point.count);
    });

    return Array.from(groups.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rawData, groupBy]);

  const chartData = {
    labels: groupedData.map((d) => d.label),
    datasets: [
      {
        label: 'Detections',
        data: groupedData.map((d) => d.count),
        backgroundColor: 'rgba(139, 92, 246, 0.7)', // purple-500
        borderColor: 'rgb(139, 92, 246)',
        borderWidth: 1,
      },
    ],
  };

  const chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const count = context.raw as number;
            return `${count.toLocaleString()} detection${count !== 1 ? 's' : ''}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0,
        },
        title: {
          display: true,
          text: 'Detections',
        },
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  const totalDetections = groupedData.reduce((sum, d) => sum + d.count, 0);
  const avgPerPeriod = groupedData.length > 0 ? Math.round(totalDetections / groupedData.length) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">
            {groupBy === 'week' ? 'Weekly' : 'Monthly'} trends
          </CardTitle>
          <Select
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as GroupBy)}
            className="w-32 h-8 text-sm"
          >
            <SelectItem value="week">By Week</SelectItem>
            <SelectItem value="month">By Month</SelectItem>
          </Select>
        </div>
        {groupedData.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {groupedData.length} {groupBy === 'week' ? 'weeks' : 'months'}, avg {avgPerPeriod.toLocaleString()} per {groupBy}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-64">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : groupedData.length > 0 ? (
            <Bar data={chartData} options={chartOptions} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No trend data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
