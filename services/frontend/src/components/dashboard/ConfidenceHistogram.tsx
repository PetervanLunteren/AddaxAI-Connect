/**
 * Confidence Histogram - Distribution of detection confidence scores
 */
import React from 'react';
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
import { statisticsApi } from '../../api/statistics';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface ConfidenceHistogramProps {
  dateRange: DateRange;
}

// Generate gradient colors from red (low confidence) to green (high confidence)
function getConfidenceColors(binCount: number): string[] {
  const colors: string[] = [];
  for (let i = 0; i < binCount; i++) {
    const ratio = i / (binCount - 1);
    // Gradient: red -> yellow -> green
    const r = Math.round(255 * (1 - ratio));
    const g = Math.round(200 * ratio + 55);
    const b = 50;
    colors.push(`rgba(${r}, ${g}, ${b}, 0.7)`);
  }
  return colors;
}

export const ConfidenceHistogram: React.FC<ConfidenceHistogramProps> = ({ dateRange }) => {
  // Fetch confidence distribution data
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'confidence-distribution', dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      statisticsApi.getConfidenceDistribution({
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
      }),
  });

  const colors = data ? getConfidenceColors(data.length) : [];

  const chartData = {
    labels: data?.map((bin) => bin.bin_label) ?? [],
    datasets: [
      {
        label: 'Count',
        data: data?.map((bin) => bin.count) ?? [],
        backgroundColor: colors,
        borderColor: colors.map((c) => c.replace('0.7', '1')),
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
            const bin = data?.[context.dataIndex];
            return `${count} detection${count !== 1 ? 's' : ''} (${Math.round((bin?.bin_min ?? 0) * 100)}%-${Math.round((bin?.bin_max ?? 0) * 100)}%)`;
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
          text: 'Detection Count',
        },
      },
      x: {
        title: {
          display: true,
          text: 'Confidence Range',
        },
      },
    },
  };

  const totalDetections = data?.reduce((sum, bin) => sum + bin.count, 0) ?? 0;
  const avgConfidence =
    data && totalDetections > 0
      ? data.reduce((sum, bin) => sum + ((bin.bin_min + bin.bin_max) / 2) * bin.count, 0) / totalDetections
      : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Confidence Distribution</CardTitle>
        {data && data.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {totalDetections.toLocaleString()} detections, avg confidence: {(avgConfidence * 100).toFixed(1)}%
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-64">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : data && data.length > 0 && totalDetections > 0 ? (
            <Bar data={chartData} options={chartOptions} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No confidence data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
