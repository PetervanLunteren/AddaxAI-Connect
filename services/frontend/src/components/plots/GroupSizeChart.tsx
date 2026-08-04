/**
 * Group size distributions.
 *
 * Render-only: the page owns the filters, the layout and the PlotExplainer.
 *
 * Two modes, because they answer different questions.
 *
 * One chart per species keeps the raw event counts on the y-axis, which is
 * what you want when reading a single species in detail.
 *
 * All species in one chart switches the y-axis to share of events, because
 * raw counts on a shared axis are misleading: fallow deer's 72 solitary events
 * would set the scale and a species with 5 events would be invisible. As
 * percentages they compare properly, at the cost of making a thin sample look
 * as solid as a thick one, so the event count stays next to every species.
 *
 * No smoothing curve and no in-chart mean marker. Group size is a whole number,
 * so a line between the bars would imply values like 2.4 individuals that cannot
 * exist. The mean is printed in the stat row above each chart instead, where it
 * does not compete with the bars.
 */
import React from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Legend,
  Tooltip,
} from 'chart.js';
import type { GroupSizeSpecies } from '../../api/types';
import { normalizeLabel } from '../../utils/labels';

/** Below this many events a distribution is too thin to read much into. */
export const LOW_EVENT_COUNT = 20;

// One series, so a light fill with a thin brand-teal outline. Solid brand teal
// made a wall of dark blocks, since one bar usually holds almost every event.
const BAR_FILL = '#71b7ba';
const BAR_BORDER = '#0f6064';
// Fixed order, from the four-value palette in FRONTEND_CONVENTIONS.md. Assigned
// by position in the selection, never generated, so colours stay stable. Left
// solid: four hues have to stay apart from each other, lightening them would
// push them together.
const SERIES_COLORS = ['#0f6064', '#ff8945', '#71b7ba', '#882000'];

ChartJS.register(CategoryScale, LinearScale, BarElement, Legend, Tooltip);

const StatRow: React.FC<{ species: GroupSizeSpecies }> = ({ species }) => (
  <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground tabular-nums">
    <span>mean <strong className="text-foreground">{species.mean.toFixed(2)}</strong></span>
    <span>min <strong className="text-foreground">{species.min}</strong></span>
    <span>max <strong className="text-foreground">{species.max}</strong></span>
    <span>events <strong className="text-foreground">{species.events}</strong></span>
  </div>
);

const LowSampleNote: React.FC<{ events: number }> = ({ events }) => (
  <p className="mt-3 border-t pt-3 text-xs text-amber-700 dark:text-amber-400">
    Only {events} events, interpret with caution
  </p>
);

const axisTitles = (yText: string) => ({
  x: { title: { display: true, text: 'Individuals per event' }, grid: { display: false } },
  y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: yText } },
});

interface SingleProps {
  species: GroupSizeSpecies;
}

/** One species, raw event counts per group size. */
export const GroupSizeChart: React.FC<SingleProps> = ({ species }) => {
  const labels = species.histogram.map((b) => String(b.group_size));

  const data = {
    labels,
    datasets: [
      {
        data: species.histogram.map((b) => b.events),
        backgroundColor: BAR_FILL,
        borderColor: BAR_BORDER,
        borderWidth: 1,
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
            const pct = species.events > 0 ? ((events / species.events) * 100).toFixed(0) : '0';
            return ` ${events} event${events === 1 ? '' : 's'} (${pct}%)`;
          },
        },
      },
    },
    scales: axisTitles('Events'),
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-semibold">{normalizeLabel(species.species)}</h3>
        <StatRow species={species} />
      </div>
      <div className="h-52 mt-3">
        <Bar data={data} options={options} />
      </div>
      {species.events < LOW_EVENT_COUNT && <LowSampleNote events={species.events} />}
    </div>
  );
};

interface CombinedProps {
  species: GroupSizeSpecies[];
}

/** Every species on one axis, as share of that species' own events. */
export const GroupSizeComparisonChart: React.FC<CombinedProps> = ({ species }) => {
  const maxSize = Math.max(...species.map((s) => s.max), 1);
  const labels = Array.from({ length: maxSize }, (_, i) => String(i + 1));

  const datasets = species.map((s, i) => {
    const bySize = new Map(s.histogram.map((b) => [b.group_size, b.events]));
    return {
      label: normalizeLabel(s.species),
      data: labels.map((l) => {
        const events = bySize.get(Number(l)) ?? 0;
        return s.events > 0 ? (events / s.events) * 100 : 0;
      }),
      backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
      borderWidth: 0,
      borderRadius: 4,
    };
  });

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { usePointStyle: true, pointStyle: 'circle' } },
      tooltip: {
        callbacks: {
          title: (items: any[]) => `Group size ${items[0].label}`,
          label: (ctx: any) => {
            const s = species[ctx.datasetIndex];
            const size = Number(ctx.label);
            const events = s.histogram.find((b) => b.group_size === size)?.events ?? 0;
            return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(0)}% (${events} of ${s.events} events)`;
          },
        },
      },
    },
    scales: {
      x: { title: { display: true, text: 'Individuals per event' }, grid: { display: false } },
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Share of that species events (%)' },
        ticks: { callback: (v: any) => `${v}%` },
      },
    },
  };

  const thin = species.filter((s) => s.events < LOW_EVENT_COUNT);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="font-semibold">All selected species</h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground tabular-nums">
          {species.map((s) => (
            <span key={s.species}>
              {normalizeLabel(s.species)}{' '}
              <strong className="text-foreground">{s.mean.toFixed(2)}</strong>{' '}
              <span className="text-xs">n={s.events}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="h-80 mt-3">
        <Bar data={{ labels, datasets }} options={options} />
      </div>
      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
        Bars show each species as a share of its own events, so species with very
        different totals can be compared.
      </p>
      {thin.length > 0 && (
        <LowSampleNote events={Math.min(...thin.map((s) => s.events))} />
      )}
    </div>
  );
};
