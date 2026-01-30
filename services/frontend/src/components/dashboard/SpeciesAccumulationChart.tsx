/**
 * Species Accumulation Chart - Cumulative line chart showing species discovered over time
 */
import React from 'react';
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
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface SpeciesAccumulationChartProps {
  dateRange: DateRange;
}

export const SpeciesAccumulationChart: React.FC<SpeciesAccumulationChartProps> = ({ dateRange }) => {
  // Fetch species accumulation data
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'species-accumulation', dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      statisticsApi.getSpeciesAccumulation({
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
      }),
  });

  const chartData = {
    labels:
      data?.map((d) =>
        new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      ) ?? [],
    datasets: [
      {
        label: 'Cumulative Species',
        data: data?.map((d) => d.cumulative_species) ?? [],
        borderColor: 'rgb(16, 185, 129)', // green-500
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: data && data.length < 30 ? 3 : 1,
        pointHoverRadius: 5,
      },
    ],
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const point = data?.[context.dataIndex];
            if (!point) return '';
            const lines = [`${point.cumulative_species} species total`];
            if (point.new_species.length > 0) {
              lines.push(`New: ${point.new_species.map(s => normalizeLabel(s)).join(', ')}`);
            }
            return lines;
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
          text: 'Cumulative Species',
        },
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  const totalSpecies = data && data.length > 0 ? data[data.length - 1].cumulative_species : 0;
  const daysWithNewSpecies = data?.filter((d) => d.new_species.length > 0).length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Species Accumulation</CardTitle>
        {data && data.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {totalSpecies} species discovered ({daysWithNewSpecies} days with new discoveries)
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-64">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : data && data.length > 0 ? (
            <Line data={chartData} options={chartOptions} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No species data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
