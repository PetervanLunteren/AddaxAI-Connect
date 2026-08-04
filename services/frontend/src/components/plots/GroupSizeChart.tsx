/**
 * Group size distribution for one species.
 *
 * Render-only: the page owns the filters, the layout and the PlotExplainer.
 * One card per species rather than all species on one axis, because these
 * distributions are heavily skewed (group size 1 dominates every species), so
 * overlaid bars would bury the tail, and separate cards make very different
 * sample sizes obvious instead of hiding them.
 *
 * Bars are one colour on purpose: the group size is on the axis, so colour
 * would carry no information.
 */
import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';
import type { GroupSizeSpecies } from '../../api/types';
import { normalizeLabel } from '../../utils/labels';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

/** Below this many events a distribution is too thin to read much into. */
export const LOW_EVENT_COUNT = 20;

const BAR_COLOR = '#0f6064';

interface GroupSizeChartProps {
  species: GroupSizeSpecies;
  /** Named under every chart so a screenshot cannot hide which counts these are. */
  sourceLabel: string;
}

export const GroupSizeChart: React.FC<GroupSizeChartProps> = ({ species, sourceLabel }) => {
  const labels = species.histogram.map((b) => String(b.group_size));
  const counts = species.histogram.map((b) => b.events);

  const data = {
    labels,
    datasets: [
      {
        data: counts,
        backgroundColor: BAR_COLOR,
        borderWidth: 0,
        borderRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: any[]) => `Group size ${items[0].label}`,
          label: (ctx: any) => {
            const events = ctx.parsed.y as number;
            const pct = species.events > 0
              ? ((events / species.events) * 100).toFixed(0)
              : '0';
            return ` ${events} event${events === 1 ? '' : 's'} (${pct}%)`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'Individuals per event' }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Events' } },
    },
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-semibold">{normalizeLabel(species.species)}</h3>
        <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground tabular-nums">
          <span>mean <strong className="text-foreground">{species.mean.toFixed(2)}</strong></span>
          <span>min <strong className="text-foreground">{species.min}</strong></span>
          <span>max <strong className="text-foreground">{species.max}</strong></span>
          <span>events <strong className="text-foreground">{species.events}</strong></span>
        </div>
      </div>

      <div className="h-52 mt-3">
        <Bar data={data} options={options} />
      </div>

      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{sourceLabel}</p>

      {species.events < LOW_EVENT_COUNT && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          Only {species.events} events, interpret with caution
        </p>
      )}
    </div>
  );
};
