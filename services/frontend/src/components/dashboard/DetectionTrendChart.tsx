/**
 * Detection Trend Chart - Shows detection counts with day/week/month granularity
 */
import React, { useState, useEffect, useMemo } from 'react';
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
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Select, SelectItem } from '../ui/Select';
import { statisticsApi } from '../../api/statistics';
import { getSpeciesColor } from '../../utils/species-colors';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface DetectionTrendChartProps {
  dateRange: DateRange;
  projectId?: number;
}

type Granularity = 'day' | 'week' | 'month';

// Calculate optimal granularity based on date range span
function getOptimalGranularity(startDate: string | null, endDate: string | null): Granularity {
  if (!startDate || !endDate) return 'day';

  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 30) return 'day';
  if (daysDiff <= 90) return 'week';
  return 'month';
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const DetectionTrendChart: React.FC<DetectionTrendChartProps> = ({ dateRange, projectId }) => {
  const [selectedSpecies, setSelectedSpecies] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>(() =>
    getOptimalGranularity(dateRange.startDate, dateRange.endDate)
  );

  // Update granularity when date range changes
  useEffect(() => {
    setGranularity(getOptimalGranularity(dateRange.startDate, dateRange.endDate));
  }, [dateRange.startDate, dateRange.endDate]);

  // Fetch species list for the selector (sorted by count, most observed first)
  const { data: speciesList } = useQuery({
    queryKey: ['statistics', 'species', projectId],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId),
    enabled: projectId !== undefined,
  });

  // Default to most observed species when data loads
  useEffect(() => {
    if (speciesList && speciesList.length > 0 && selectedSpecies === null) {
      setSelectedSpecies(speciesList[0].species);
    }
  }, [speciesList, selectedSpecies]);

  // Fetch detection trend data
  const { data: rawData, isLoading } = useQuery({
    queryKey: ['statistics', 'detection-trend', projectId, selectedSpecies, dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      statisticsApi.getDetectionTrend(projectId, {
        species: selectedSpecies === 'all' || !selectedSpecies ? undefined : selectedSpecies,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
      }),
    enabled: projectId !== undefined && selectedSpecies !== null,
  });

  // Group data by granularity
  const data = useMemo(() => {
    if (!rawData) return null;
    if (granularity === 'day') return rawData;

    const groups = new Map<string, number>();

    rawData.forEach((point) => {
      const date = new Date(point.date);
      let key: string;

      if (granularity === 'week') {
        const week = getWeekNumber(date);
        const year = date.getFullYear();
        key = `${year}-W${week.toString().padStart(2, '0')}`;
      } else {
        key = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      }

      groups.set(key, (groups.get(key) ?? 0) + point.count);
    });

    return Array.from(groups.entries())
      .map(([label, count]) => ({ date: label, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [rawData, granularity]);

  // Use species color if selected, otherwise teal
  const lineColor =
    selectedSpecies && selectedSpecies !== 'all'
      ? getSpeciesColor(selectedSpecies)
      : '#0f6064';

  // Create gradient for fill
  const createGradient = (ctx: CanvasRenderingContext2D, chartArea: { top: number; bottom: number }, color: string) => {
    // Parse color to get RGB values
    const isHex = color.startsWith('#');
    let r: number, g: number, b: number;
    if (isHex) {
      const hex = color.slice(1);
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      // Default to teal
      r = 15; g = 96; b = 100;
    }

    const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.05)`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.3)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.6)`);
    return gradient;
  };

  // Format labels based on granularity
  const formatLabel = (d: { date: string }) => {
    if (granularity === 'day') {
      return new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return d.date; // Week/month labels are already formatted
  };

  const chartData: ChartData<'line'> = {
    labels: data?.map(formatLabel) ?? [],
    datasets: [
      {
        label: 'Detections',
        data: data?.map((d) => d.count) ?? [],
        borderColor: lineColor,
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return 'rgba(15, 96, 100, 0.2)';
          return createGradient(ctx, chartArea, lineColor);
        },
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
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  const totalDetections = data?.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const periodCount = data?.length ?? 0;
  const avgPerPeriod = periodCount > 0 ? Math.round(totalDetections / periodCount) : 0;

  const granularityLabel = granularity === 'day' ? 'days' : granularity === 'week' ? 'weeks' : 'months';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Detection trend</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={granularity}
              onValueChange={(v) => setGranularity(v as Granularity)}
              className="w-28 h-9 text-sm"
            >
              <SelectItem value="day">By day</SelectItem>
              <SelectItem value="week">By week</SelectItem>
              <SelectItem value="month">By month</SelectItem>
            </Select>
            <Select
              value={selectedSpecies ?? ''}
              onValueChange={setSelectedSpecies}
              className="w-40 h-9 text-sm"
            >
              <SelectItem value="all">All species</SelectItem>
              {speciesList?.map((s) => (
                <SelectItem key={s.species} value={s.species}>
                  {normalizeLabel(s.species)}
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>
        {data && data.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {totalDetections.toLocaleString()} detections over {periodCount} {granularityLabel}
            {granularity !== 'day' && `, avg ${avgPerPeriod.toLocaleString()} per ${granularity}`}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-72">
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
