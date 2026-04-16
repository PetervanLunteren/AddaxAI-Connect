/**
 * Demographic doughnut chart — sex or life stage distribution from verified observations.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import chroma from 'chroma-js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Select, SelectItem } from '../ui/Select';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel } from '../../utils/labels';
import type { DateRange } from './DateRangeFilter';

ChartJS.register(ArcElement, Tooltip, Legend);

// Map each value to a point on the app's teal→yellow gradient, sorted
// alphabetically: first key gets #0f6064 (dark teal), last key gets
// #f9f871 (light yellow). Same palette endpoints as the detection-rate
// map in color-scale.ts, just reversed so categorical keys read dark→light
// instead of low→high.
function buildGradientPalette(keys: string[]): Record<string, string> {
  const sorted = [...keys].sort();
  const colors = chroma.scale(['#0f6064', '#f9f871']).mode('lab').colors(sorted.length);
  return Object.fromEntries(sorted.map((key, i) => [key, colors[i]]));
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

interface DemographicChartProps {
  dateRange: DateRange;
  projectId?: number;
  cameraIds?: string;
}

export const DemographicChart: React.FC<DemographicChartProps> = ({
  dateRange,
  projectId,
  cameraIds,
}) => {
  const [field, setField] = useState<'sex' | 'life_stage' | 'behavior'>('sex');
  const [selectedSpecies, setSelectedSpecies] = useState<string>('all');

  const { data: speciesList } = useQuery({
    queryKey: ['statistics', 'species', projectId],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId),
    enabled: projectId !== undefined,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'demographics', projectId, field, selectedSpecies, dateRange.startDate, dateRange.endDate, cameraIds],
    queryFn: () =>
      statisticsApi.getDemographics(projectId!, {
        field,
        species: selectedSpecies === 'all' ? undefined : selectedSpecies,
        start_date: dateRange.startDate || undefined,
        end_date: dateRange.endDate || undefined,
        camera_ids: cameraIds,
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

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' },
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const count = context.raw as number;
            const pct = data && data.total > 0 ? ((count / data.total) * 100).toFixed(1) : '0';
            return ` ${context.label}: ${count} (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Demographics</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={field}
              onValueChange={(v) => setField(v as 'sex' | 'life_stage' | 'behavior')}
              className="w-28 h-9 text-sm"
            >
              <SelectItem value="sex">Sex</SelectItem>
              <SelectItem value="life_stage">Life stage</SelectItem>
              <SelectItem value="behavior">Behaviour</SelectItem>
            </Select>
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
        </div>
        <p className="text-sm text-muted-foreground">
          {field === 'sex' ? 'Sex' : field === 'life_stage' ? 'Life stage' : 'Behaviour'} distribution from verified observations
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
            <Doughnut data={chartData} options={chartOptions} />
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
