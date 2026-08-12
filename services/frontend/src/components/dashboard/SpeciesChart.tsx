/**
 * Which species live here, as a horizontal bar chart.
 *
 * A real chart rather than a list of filled tracks. A track behind a bar
 * implies a maximum the value is working towards, which is what a progress
 * bar means, and species counts are not progress towards anything. Bars on a
 * common baseline with an axis is the form people read most accurately, and
 * it is what a reader expects on a scientific page.
 *
 * One colour, because the species name is already on the axis and a second
 * encoding of the same thing would say nothing. Same fill and outline as the
 * group size charts, so the two look like one system.
 *
 * Two ways to count, chosen with the Abundance / Frequency dropdown, both
 * already returned per species by /api/statistics/species-distribution so the
 * toggle needs no refetch:
 *   - Abundance (default): individuals, SUM(event_count) over the independence
 *     CTE where event_count is the MaxN of an event. Two roe deer together
 *     once plus a single roe deer an hour later is three.
 *   - Frequency: independent events, how many separate visits, the basis for
 *     RAI. The same two examples are two events.
 * Different questions rank species differently, so the bars re-rank to the top
 * ten of whichever metric is shown, and the axis label follows. The dropdown
 * hides when the project groups nothing (no independence interval, events null).
 *
 * Person, vehicle and empty are left out. They are detector categories, not
 * species, and the other pages already exclude them.
 */
import React, { useState } from 'react';
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
import { Select, SelectItem } from '../ui/Select';
import { statisticsApi } from '../../api/statistics';
import { normalizeLabel, isWildlifeLabel } from '../../utils/labels';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

/** Species shown before the chart is cut. Beyond this it stops being readable. */
const MAX_BARS = 10;

const BAR_FILL = 'rgba(15, 96, 100, 0.18)';
const BAR_BORDER = '#0f6064';

/** One row of bar, plus room for the axis, so the card grows with the data. */
const ROW_HEIGHT = 30;
const AXIS_HEIGHT = 40;

type Mode = 'individuals' | 'events';

interface SpeciesChartProps {
  projectId?: number;
  siteIds?: string;
}

export const SpeciesChart: React.FC<SpeciesChartProps> = ({ projectId, siteIds }) => {
  const navigate = useNavigate();
  // Abundance by default, the metric the card has always shown.
  const [mode, setMode] = useState<Mode>('individuals');

  const { data: species, isLoading } = useQuery({
    queryKey: ['statistics', 'species', projectId, siteIds],
    queryFn: () => statisticsApi.getSpeciesDistribution(projectId, siteIds),
    enabled: projectId !== undefined,
  });

  const wildlife = (species ?? []).filter((s) => isWildlifeLabel(s.species));
  // Frequency needs the per-species event count. When the project groups
  // nothing it is null, so the toggle disappears and the card stays on
  // abundance rather than drawing a wall of zeros.
  const hasEvents = wildlife.some((s) => s.events != null);
  const activeMode: Mode = hasEvents ? mode : 'individuals';

  const valueOf = (s: { count: number; events?: number | null }) =>
    activeMode === 'events' ? s.events ?? 0 : s.count;

  // Re-rank to the top of the chosen metric: the most-photographed species and
  // the most-often-seen species are not always the same one.
  const ranked = [...wildlife].sort((a, b) => valueOf(b) - valueOf(a));
  const shown = ranked.slice(0, MAX_BARS);
  // Share is over every wildlife species, including those below the cut, so a
  // percentage describes the project rather than just this chart.
  const total = wildlife.reduce((sum, s) => sum + valueOf(s), 0);

  const axisLabel = activeMode === 'events' ? 'Independent events' : 'Individuals';
  const caption =
    activeMode === 'events'
      ? 'Sightings, a new one after each gap in time.'
      : 'Individuals per sighting, summed across sightings.';

  const data = {
    labels: shown.map((s) => normalizeLabel(s.species)),
    datasets: [
      {
        data: shown.map(valueOf),
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
          // Both numbers together, because one without the other hides the
          // story: 50 individuals across 40 events is a scattering of singles,
          // across 5 events it is a herd. The share is of whichever metric the
          // bars are showing, and the shown metric leads.
          label: (ctx: any) => {
            const picked = shown[ctx.dataIndex];
            const individuals = picked.count;
            const events = picked.events ?? null;
            const mean = events ? (individuals / events).toFixed(2) : null;
            const activeVal = activeMode === 'events' ? events ?? 0 : individuals;
            const share = total > 0 ? ((activeVal / total) * 100).toFixed(1) : '0';
            if (activeMode === 'events') {
              return [
                ` ${(events ?? 0).toLocaleString()} independent events, ${share}% of all events`,
                ` ${individuals.toLocaleString()} individuals${mean ? `, ${mean} per event` : ''}`,
              ];
            }
            const lines = [` ${individuals.toLocaleString()} individuals, ${share}% of all animals counted`];
            if (events) {
              lines.push(
                ` across ${events.toLocaleString()} independent event${events === 1 ? '' : 's'}, ${mean} per event`,
              );
            }
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: { precision: 0 },
        title: { display: true, text: axisLabel },
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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg">Species detected</CardTitle>
          {hasEvents && (
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="w-32 h-9 text-sm"
            >
              <SelectItem value="individuals">Abundance</SelectItem>
              <SelectItem value="events">Frequency</SelectItem>
            </Select>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {wildlife.length > MAX_BARS ? `Top ${MAX_BARS} of ${wildlife.length}. ` : ''}
          {caption}
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
          // The share of each species is in the tooltip rather than printed
          // under the chart, which would be ten more numbers competing with the
          // bars that already show the same comparison.
          <div style={{ height: shown.length * ROW_HEIGHT + AXIS_HEIGHT }}>
            <Bar data={data} options={options} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
