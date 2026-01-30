/**
 * Detection Trend Chart - Line chart showing daily detection counts
 */
import React, { useState } from 'react';
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
import { Select, SelectItem } from '../ui/Select';
import { statisticsApi } from '../../api/statistics';
import { getSpeciesColor, getSpeciesColorWithAlpha } from '../../utils/species-colors';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface DetectionTrendChartProps {
  dateRange: DateRange;
}

export const DetectionTrendChart: React.FC<DetectionTrendChartProps> = ({ dateRange }) => {
  const [selectedSpecies, setSelectedSpecies] = useState<string>('all');

  // Fetch species list for the selector
  const { data: speciesList } = useQuery({
    queryKey: ['statistics', 'species'],
    queryFn: () => statisticsApi.getSpeciesDistribution(),
  });

  // Fetch detection trend data
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'detection-trend', selectedSpecies, dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      statisticsApi.getDetectionTrend({
        species: selectedSpecies === 'all' ? undefined : selectedSpecies,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
      }),
  });

  // Use species color if selected, otherwise teal
  const lineColor =
    selectedSpecies !== 'all'
      ? getSpeciesColor(selectedSpecies)
      : '#0f6064';
  const fillColor =
    selectedSpecies !== 'all'
      ? getSpeciesColorWithAlpha(selectedSpecies, 0.2)
      : 'rgba(15, 96, 100, 0.2)';

  const chartData = {
    labels:
      data?.map((d) =>
        new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      ) ?? [],
    datasets: [
      {
        label: 'Detections',
        data: data?.map((d) => d.count) ?? [],
        borderColor: lineColor,
        backgroundColor: fillColor,
        tension: 0.3,
        fill: true,
        pointRadius: data && data.length < 30 ? 3 : 0,
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
            const count = context.raw as number;
            return `${count} detection${count !== 1 ? 's' : ''}`;
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
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  const totalDetections = data?.reduce((sum, d) => sum + d.count, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Detection trend</CardTitle>
          <Select
            value={selectedSpecies}
            onValueChange={setSelectedSpecies}
            className="w-40 h-8 text-sm"
          >
            <SelectItem value="all">All Species</SelectItem>
            {speciesList?.map((s) => (
              <SelectItem key={s.species} value={s.species}>
                {normalizeLabel(s.species)}
              </SelectItem>
            ))}
          </Select>
        </div>
        {data && (
          <p className="text-sm text-muted-foreground">
            {totalDetections.toLocaleString()} detections over {data.length} days
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
              <p className="text-muted-foreground">No detection data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
