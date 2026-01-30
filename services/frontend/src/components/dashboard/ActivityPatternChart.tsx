/**
 * Activity Pattern Chart - Radial polar chart showing 24-hour activity patterns
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PolarArea } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  RadialLinearScale,
  ArcElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Select, SelectItem } from '../ui/Select';
import { statisticsApi } from '../../api/statistics';
import { getSpeciesColor, getSpeciesColorWithAlpha } from '../../utils/species-colors';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(RadialLinearScale, ArcElement, Tooltip, Legend);

interface ActivityPatternChartProps {
  dateRange: DateRange;
}

// Generate colors for 24 hours based on time of day
function getHourColors(): { background: string[]; border: string[] } {
  const background: string[] = [];
  const border: string[] = [];

  for (let hour = 0; hour < 24; hour++) {
    let color: string;
    // Night: 21:00 - 05:00 (dark blue)
    if (hour >= 21 || hour < 5) {
      color = 'rgba(30, 58, 138, 0.7)'; // blue-900
    }
    // Dawn/Dusk: 05:00 - 07:00, 17:00 - 21:00 (orange)
    else if ((hour >= 5 && hour < 7) || (hour >= 17 && hour < 21)) {
      color = 'rgba(234, 88, 12, 0.7)'; // orange-600
    }
    // Day: 07:00 - 17:00 (yellow)
    else {
      color = 'rgba(250, 204, 21, 0.7)'; // yellow-400
    }
    background.push(color);
    border.push(color.replace('0.7', '1'));
  }

  return { background, border };
}

export const ActivityPatternChart: React.FC<ActivityPatternChartProps> = ({ dateRange }) => {
  const [selectedSpecies, setSelectedSpecies] = useState<string>('all');

  // Fetch species list for the selector
  const { data: speciesList } = useQuery({
    queryKey: ['statistics', 'species'],
    queryFn: () => statisticsApi.getSpeciesDistribution(),
  });

  // Fetch activity pattern data
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'activity-pattern', selectedSpecies, dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      statisticsApi.getActivityPattern({
        species: selectedSpecies === 'all' ? undefined : selectedSpecies,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
      }),
  });

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

  const hourColors = getHourColors();

  // Use species color if a specific species is selected, otherwise use time-of-day colors
  const backgroundColor =
    selectedSpecies !== 'all'
      ? Array(24).fill(getSpeciesColorWithAlpha(selectedSpecies, 0.7))
      : hourColors.background;

  const borderColor =
    selectedSpecies !== 'all'
      ? Array(24).fill(getSpeciesColor(selectedSpecies))
      : hourColors.border;

  const chartData = {
    labels: hourLabels,
    datasets: [
      {
        data: data?.hours.map((h) => h.count) ?? Array(24).fill(0),
        backgroundColor,
        borderColor,
        borderWidth: 1,
      },
    ],
  };

  const chartOptions: ChartOptions<'polarArea'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const hour = context.label;
            const count = context.raw as number;
            return `${hour}: ${count} detection${count !== 1 ? 's' : ''}`;
          },
        },
      },
    },
    scales: {
      r: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
          display: true,
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
      },
    },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Activity Pattern (24h)</CardTitle>
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
            {data.total_detections.toLocaleString()} total detections
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="h-72">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : data && data.hours.some((h) => h.count > 0) ? (
            <PolarArea data={chartData} options={chartOptions} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No activity data available</p>
            </div>
          )}
        </div>
        {/* Legend for time-of-day colors when showing all species */}
        {selectedSpecies === 'all' && (
          <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(30, 58, 138, 0.7)' }} />
              <span>Night</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(234, 88, 12, 0.7)' }} />
              <span>Dawn/Dusk</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(250, 204, 21, 0.7)' }} />
              <span>Day</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
