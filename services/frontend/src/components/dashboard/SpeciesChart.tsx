/**
 * Which species live here, as a horizontal bar chart.
 *
 * A real chart rather than a list of filled tracks. A track behind a bar
 * implies a maximum the value is working towards, which is what a progress
 * bar means, and species counts are not progress towards anything. Bars on a
 * common baseline with an axis is the form people read most accurately, and
 * it is what a reader expects on a scientific page.
 *
 * Bars are scaled by the axis so the chart uses its width; the axis carries
 * the absolute numbers and the footer carries each species' share of all
 * detections. One colour, because the species name is already on the axis and
 * a second encoding of the same thing would say nothing. Same fill and outline
 * as the group size charts, so the two look like one system.
 *
 * Person, vehicle and empty are left out. They are detector categories, not
 * species, and the other pages already exclude them.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel, isWildlifeLabel } from '../../utils/labels';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

/** Species shown before the chart is cut. Beyond this it stops being readable. */
const MAX_BARS = 8;

const BAR_FILL = 'rgba(15, 96, 100, 0.18)';
const BAR_BORDER = '#0f6064';

/** One row of bar, plus room for the axis, so the card grows with the data. */
const ROW_HEIGHT = 30;
const AXIS_HEIGHT = 40;

interface SpeciesChartProps {
  projectId?: number;
  siteIds?: string;
}

export const SpeciesChart: React.FC<SpeciesChartProps> = ({ projectId, siteIds }) => {
  const navigate = useNavigate();

  const { data: species, isLoading } = useQuery({
    queryKey: ['statistics', 'species', projectId, siteIds],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId, siteIds),
    enabled: projectId !== undefined,
  });

  const wildlife = (species ?? []).filter((s) => isWildlifeLabel(s.species));
  const shown = wildlife.slice(0, MAX_BARS);
  // Share is of every wildlife detection, including the species below the cut,
  // so the percentages describe the project rather than just this chart.
  const total = wildlife.reduce((sum, s) => sum + s.count, 0);

  const data = {
    labels: shown.map((s) => normalizeLabel(s.species)),
    datasets: [
      {
        data: shown.map((s) => s.count),
        backgroundColor: BAR_FILL,
        borderColor: BAR_BORDER,
        borderWidth: 1.25,
        borderRadius: 4,
        barPercentage: 0.75,
      },
    ],
  };

  const options = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const count = ctx.parsed.x as number;
            const share = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
            return ` ${count.toLocaleString()} events, ${share}% of all detections`;
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: { precision: 0 },
        title: { display: true, text: 'Independent events' },
      },
      y: { grid: { display: false } },
    },
    onClick: (_event: unknown, elements: { index: number }[]) => {
      const picked = elements[0] && shown[elements[0].index];
      if (picked && projectId !== undefined) {
        navigate(`/projects/${projectId}/images?species=${encodeURIComponent(picked.species)}`);
      }
    },
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Species detected</CardTitle>
        <p className="text-sm text-muted-foreground">
          {wildlife.length > MAX_BARS
            ? `Top ${MAX_BARS} of ${wildlife.length}, click a bar to open its images`
            : 'Click a bar to open its images'}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No animals detected yet in this selection
          </p>
        ) : (
          <>
            <div style={{ height: shown.length * ROW_HEIGHT + AXIS_HEIGHT }}>
              <Bar data={data} options={options} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs tabular-nums text-muted-foreground">
              {shown.map((s) => (
                <span key={s.species}>
                  {normalizeLabel(s.species)}{' '}
                  <strong className="font-medium text-foreground">
                    {total > 0 ? Math.round((s.count / total) * 100) : 0}%
                  </strong>
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
