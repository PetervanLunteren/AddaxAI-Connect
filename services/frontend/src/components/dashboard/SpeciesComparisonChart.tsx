/**
 * Species Comparison Chart - Compare activity patterns between multiple species
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
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
import { statisticsApi } from '../../api/statistics';
import { getSpeciesColor, setSpeciesContext } from '../../utils/species-colors';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface SpeciesComparisonChartProps {
  dateRange: DateRange;
}

export const SpeciesComparisonChart: React.FC<SpeciesComparisonChartProps> = ({ dateRange }) => {
  const [selectedSpecies, setSelectedSpecies] = useState<string[]>([]);

  // Fetch species list
  const { data: speciesList } = useQuery({
    queryKey: ['statistics', 'species'],
    queryFn: () => statisticsApi.getSpeciesDistribution(),
  });

  // Sort species list alphabetically for display
  const sortedSpeciesList = useMemo(() => {
    if (!speciesList) return [];
    return [...speciesList].sort((a, b) => a.species.localeCompare(b.species));
  }, [speciesList]);

  // Set species context for colors when list changes
  useEffect(() => {
    if (sortedSpeciesList.length > 0) {
      setSpeciesContext(sortedSpeciesList.map((s) => s.species));
    }
  }, [sortedSpeciesList]);

  // Auto-select top 3 species when data loads
  useEffect(() => {
    if (speciesList && speciesList.length > 0 && selectedSpecies.length === 0) {
      setSelectedSpecies(speciesList.slice(0, 3).map((s) => s.species));
    }
  }, [speciesList, selectedSpecies.length]);

  // Create gradient for fill
  const createGradient = (ctx: CanvasRenderingContext2D, chartArea: { top: number; bottom: number }, color: string) => {
    // Parse hex color to get RGB values
    const hex = color.startsWith('#') ? color.slice(1) : color;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.05)`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.3)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.6)`);
    return gradient;
  };

  // Fetch activity patterns for each selected species
  const activityQueries = useQueries({
    queries: selectedSpecies.map((species) => ({
      queryKey: ['statistics', 'activity-pattern', species, dateRange.startDate, dateRange.endDate],
      queryFn: () =>
        statisticsApi.getActivityPattern({
          species,
          start_date: dateRange.startDate || undefined,
          end_date: dateRange.endDate || undefined,
        }),
      enabled: selectedSpecies.length > 0,
    })),
  });

  const isLoading = activityQueries.some((q) => q.isLoading);
  const allData = activityQueries.map((q, i) => ({
    species: selectedSpecies[i],
    data: q.data,
  }));

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

  const chartData: ChartData<'line'> = {
    labels: hourLabels,
    datasets: allData
      .filter((d) => d.data)
      .map((d) => {
        const lineColor = getSpeciesColor(d.species);
        return {
          label: normalizeLabel(d.species),
          data: d.data?.hours.map((h) => h.count) ?? [],
          borderColor: lineColor,
          backgroundColor: (context) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return `rgba(15, 96, 100, 0.2)`;
            return createGradient(ctx, chartArea, lineColor);
          },
          tension: 0.3,
          fill: true,
          pointRadius: 2,
          pointHoverRadius: 5,
        };
      }),
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
      },
      tooltip: {
        mode: 'index',
        intersect: false,
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
        title: {
          display: true,
          text: 'Hour of Day',
        },
      },
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false,
    },
  };

  const toggleSpecies = (species: string) => {
    setSelectedSpecies((prev) =>
      prev.includes(species)
        ? prev.filter((s) => s !== species)
        : prev.length < 5
          ? [...prev, species]
          : prev
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Species activity comparison</CardTitle>
        <p className="text-sm text-muted-foreground">
          Compare diel activity patterns (select up to 5 species)
        </p>
      </CardHeader>
      <CardContent>
        {/* Species selector chips (sorted alphabetically) */}
        <div className="flex flex-wrap gap-2 mb-4">
          {sortedSpeciesList.map((s) => {
            const isSelected = selectedSpecies.includes(s.species);
            return (
              <button
                key={s.species}
                onClick={() => toggleSpecies(s.species)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  isSelected
                    ? 'text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
                style={
                  isSelected
                    ? { backgroundColor: getSpeciesColor(s.species) }
                    : undefined
                }
              >
                {normalizeLabel(s.species)}
              </button>
            );
          })}
        </div>

        <div className="h-72">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : selectedSpecies.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Select species to compare</p>
            </div>
          ) : chartData.datasets.length > 0 ? (
            <Line data={chartData} options={chartOptions} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No activity data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
