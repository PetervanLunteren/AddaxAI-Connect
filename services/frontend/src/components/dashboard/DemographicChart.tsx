/**
 * One demographic attribute from verified observations.
 *
 * Rendered once per attribute so sex and age class are visible at the same
 * time instead of hiding behind a dropdown. Behaviour has eleven values,
 * which is far too many for a doughnut, so it renders as sorted bars. Sex
 * (three values) and life stage (four) stay doughnuts.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from 'chart.js';
import chroma from 'chroma-js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import type { DateRange } from './DateRangeFilter';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

// Map each value to a point on the app's teal→yellow gradient. The
// 'unknown' bucket is always pinned to #0f6064 (dark teal) since it is
// the catch-all and reads as the anchor across all three field types.
// Remaining keys are sorted alphabetically and gradient from the next
// shade toward #f9f871 (light yellow). Same palette endpoints as the
// detection-rate map in color-scale.ts.
function buildGradientPalette(keys: string[]): Record<string, string> {
  const others = keys.filter((k) => k !== 'unknown').sort();
  // Generate one extra slot so 'unknown' can take the dark-teal endpoint
  // without colliding with the first 'other' key.
  const colors = chroma.scale(['#0f6064', '#f9f871']).mode('lab').colors(others.length + 1);
  const palette: Record<string, string> = { unknown: colors[0] };
  others.forEach((key, i) => {
    palette[key] = colors[i + 1];
  });
  return palette;
}

const SEX_COLORS = buildGradientPalette(['female', 'male', 'unknown']);
const LIFE_STAGE_COLORS = buildGradientPalette(['adult', 'juvenile', 'subadult', 'unknown']);
const BEHAVIOR_COLORS = buildGradientPalette([
  'aggression',
  'courtship',
  'drinking',
  'foraging',
  'grooming',
  'marking',
  'nursing',
  'resting',
  'traveling',
  'unknown',
  'vigilance',
]);

export type DemographicField = 'sex' | 'life_stage' | 'behavior';

const FIELD_TITLES: Record<DemographicField, string> = {
  sex: 'Sex',
  life_stage: 'Age class',
  behavior: 'Behaviour',
};

interface DemographicChartProps {
  dateRange: DateRange;
  projectId?: number;
  siteIds?: string;
  /** Selected species. undefined means all species. */
  species?: string;
  /** Which attribute this card shows. */
  field: DemographicField;
}

export const DemographicChart: React.FC<DemographicChartProps> = ({
  dateRange,
  projectId,
  siteIds,
  species,
  field,
}) => {

  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'demographics', projectId, field, species ?? 'all', dateRange.startDate, dateRange.endDate, siteIds],
    queryFn: () =>
      statisticsApi.getDemographics(projectId!, {
        field,
        species: species || undefined,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        site_ids: siteIds,
      }),
    enabled: projectId !== undefined,
  });

  const colorMap = field === 'sex' ? SEX_COLORS : field === 'life_stage' ? LIFE_STAGE_COLORS : BEHAVIOR_COLORS;

  const chartData = {
    labels: data?.values.map(v => v.value.charAt(0).toUpperCase() + v.value.slice(1)) ?? [],
    datasets: [
      {
        data: data?.values.map(v => v.count) ?? [],
        backgroundColor: data?.values.map(v => colorMap[v.value] || '#999') ?? [],
        borderWidth: 0,
      },
    ],
  };

  // Eleven behaviour values do not fit a doughnut, so that one gets bars.
  const asBar = field === 'behavior';

  const tooltipLabel = (context: any) => {
    const count = (asBar ? context.parsed.x : context.raw) as number;
    const pct = data && data.total > 0 ? ((count / data.total) * 100).toFixed(1) : '0';
    return ` ${context.label}: ${count} (${pct}%)`;
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' },
      },
      tooltip: { callbacks: { label: tooltipLabel } },
    },
  };

  // Horizontal bars, category names on the axis, so no legend is needed.
  const barOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: tooltipLabel } },
    },
    scales: {
      x: { beginAtZero: true, ticks: { precision: 0 } },
    },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{FIELD_TITLES[field]}</CardTitle>
        <p className="text-sm text-muted-foreground">
          From verified observations
          {data ? `, ${data.total.toLocaleString()} total` : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : data && data.total > 0 ? (
            asBar ? (
              <Bar data={chartData} options={barOptions} />
            ) : (
              <Doughnut data={chartData} options={doughnutOptions} />
            )
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No verified observations yet</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
