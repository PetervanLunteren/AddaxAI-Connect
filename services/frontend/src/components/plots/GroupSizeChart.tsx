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
 * No smoothing curve. Group size is a whole number, so a line between the bars
 * would imply values like 2.4 individuals that cannot exist. The mean is drawn
 * as a vertical marker instead, which encodes something real.
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
  type Plugin,
} from 'chart.js';
import type { GroupSizeSpecies } from '../../api/types';
import { normalizeLabel } from '../../utils/labels';

/** Below this many events a distribution is too thin to read much into. */
export const LOW_EVENT_COUNT = 20;

const BAR_COLOR = '#0f6064';
// Fixed order, from the four-value palette in FRONTEND_CONVENTIONS.md. Assigned
// by position in the selection, never generated, so colours stay stable.
const SERIES_COLORS = ['#0f6064', '#ff8945', '#71b7ba', '#882000'];

/**
 * Vertical line at the mean group size. Sits between the category ticks,
 * since the mean falls between whole numbers.
 */
const meanMarkerPlugin: Plugin<'bar'> = {
  id: 'groupSizeMeanMarker',
  afterDatasetsDraw(chart, _args, options) {
    const opts = options as { mean?: number; labels?: string[] };
    const { mean, labels } = opts;
    if (mean == null || !labels || labels.length === 0) return;

    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    if (!xScale) return;

    // Interpolate the mean between the two category ticks it falls between.
    const sizes = labels.map(Number);
    let lowIndex = -1;
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] <= mean) lowIndex = i;
    }
    if (lowIndex < 0) return;
    const lowPx = xScale.getPixelForTick(lowIndex);
    const highIndex = Math.min(lowIndex + 1, sizes.length - 1);
    const highPx = xScale.getPixelForTick(highIndex);
    const span = sizes[highIndex] - sizes[lowIndex];
    const frac = span > 0 ? (mean - sizes[lowIndex]) / span : 0;
    const x = lowPx + (highPx - lowPx) * frac;

    ctx.save();
    ctx.strokeStyle = BAR_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = BAR_COLOR;
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = x > chartArea.right - 60 ? 'right' : 'left';
    ctx.fillText(`mean ${mean.toFixed(2)}`, x + (ctx.textAlign === 'right' ? -6 : 6), chartArea.top + 12);
    ctx.restore();
  },
};

ChartJS.register(CategoryScale, LinearScale, BarElement, Legend, Tooltip, meanMarkerPlugin);

const StatRow: React.FC<{ species: GroupSizeSpecies }> = ({ species }) => (
  <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground tabular-nums">
    <span>mean <strong className="text-foreground">{species.mean.toFixed(2)}</strong></span>
    <span>min <strong className="text-foreground">{species.min}</strong></span>
    <span>max <strong className="text-foreground">{species.max}</strong></span>
    <span>events <strong className="text-foreground">{species.events}</strong></span>
  </div>
);

const LowSampleNote: React.FC<{ events: number }> = ({ events }) => (
  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
    Only {events} events, interpret with caution
  </p>
);

const axisTitles = (yText: string) => ({
  x: { title: { display: true, text: 'Individuals per event' }, grid: { display: false } },
  y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: yText } },
});

interface SingleProps {
  species: GroupSizeSpecies;
  sourceLabel: string;
}

/** One species, raw event counts, with the mean marked. */
export const GroupSizeChart: React.FC<SingleProps> = ({ species, sourceLabel }) => {
  const labels = species.histogram.map((b) => String(b.group_size));

  const data = {
    labels,
    datasets: [
      {
        data: species.histogram.map((b) => b.events),
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
      groupSizeMeanMarker: { mean: species.mean, labels },
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
      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{sourceLabel}</p>
      {species.events < LOW_EVENT_COUNT && <LowSampleNote events={species.events} />}
    </div>
  );
};

interface CombinedProps {
  species: GroupSizeSpecies[];
  sourceLabel: string;
}

/** Every species on one axis, as share of that species' own events. */
export const GroupSizeComparisonChart: React.FC<CombinedProps> = ({ species, sourceLabel }) => {
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
        {sourceLabel}. Bars show each species as a share of its own events, so species with
        very different totals can be compared.
      </p>
      {thin.length > 0 && (
        <LowSampleNote events={Math.min(...thin.map((s) => s.events))} />
      )}
    </div>
  );
};
