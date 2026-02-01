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
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

// Register Chart.js components
ChartJS.register(RadialLinearScale, ArcElement, Tooltip, Legend);

interface ActivityPatternChartProps {
  dateRange: DateRange;
}

// Generate colors for 24 hours based on time of day (colors from FRONTEND_CONVENTIONS.md palette)
function getHourColors(): { background: string[]; border: string[] } {
  const background: string[] = [];
  const border: string[] = [];

  for (let hour = 0; hour < 24; hour++) {
    let bgColor: string;
    let borderColor: string;
    // Night: 21:00 - 05:00
    if (hour >= 21 || hour < 5) {
      bgColor = 'rgba(15, 96, 100, 0.7)';  // #0f6064
      borderColor = '#0f6064';
    }
    // Dawn/Dusk: 05:00 - 07:00, 17:00 - 21:00
    else if ((hour >= 5 && hour < 7) || (hour >= 17 && hour < 21)) {
      bgColor = 'rgba(255, 137, 69, 0.7)';  // #ff8945
      borderColor = '#ff8945';
    }
    // Day: 07:00 - 17:00
    else {
      bgColor = 'rgba(113, 183, 186, 0.7)';  // #71b7ba
      borderColor = '#71b7ba';
    }
    background.push(bgColor);
    border.push(borderColor);
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

  // Always use time-of-day colors for better insight
  const hourColors = getHourColors();

  const chartData = {
    labels: hourLabels,
    datasets: [
      {
        data: data?.hours.map((h) => h.count) ?? Array(24).fill(0),
        backgroundColor: hourColors.background,
        borderColor: hourColors.border,
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
          <CardTitle className="text-lg">Activity pattern</CardTitle>
          <Select
            value={selectedSpecies}
            onValueChange={setSelectedSpecies}
            className="w-36 h-9 text-sm"
          >
            <SelectItem value="all">All species</SelectItem>
            {speciesList?.map((s) => (
              <SelectItem key={s.species} value={s.species}>
                {normalizeLabel(s.species)}
              </SelectItem>
            ))}
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          24-hour pattern{data ? `, ${data.total_detections.toLocaleString()} total detections` : ''}
        </p>
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
        {/* Legend for time-of-day colors */}
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#0f6064' }} />
            <span>Night</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#ff8945' }} />
            <span>Dawn/Dusk</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: '#71b7ba' }} />
            <span>Day</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
