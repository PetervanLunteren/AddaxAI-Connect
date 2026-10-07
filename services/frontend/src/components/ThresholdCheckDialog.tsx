/**
 * Threshold check, opened from a threshold slider on the settings page.
 *
 * Shows how precision, recall and F1 change with one threshold, measured on
 * all verified images of the project, and suggests a threshold with the
 * best F1, the one closest to the slider when F1 is flat (the backend
 * decides). Apply only moves the slider; the settings page's Save, with its
 * impact preview, stays the only thing that writes.
 *
 * Every threshold slider has one, and each checks exactly what its slider
 * controls: the detection threshold ("is something there", whatever the
 * species), the classification default (all species without an override,
 * pooled) or one species' override. The other thresholds stay at their
 * saved values.
 */
import { useQuery } from '@tanstack/react-query';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import type { ChartData, ChartOptions } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { ChartLine, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { performanceApi } from '../api/performance';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, annotationPlugin);

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Icon button next to a threshold slider. One component so the detection
 * slider and the species rows cannot drift apart. */
export function ThresholdCheckButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Check against verified images"
      aria-label="Check against verified images"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
    >
      <ChartLine className="h-4 w-4" />
    </button>
  );
}

/** Which slider to check. species is the classifier label, label its
 * display name. */
export type ThresholdCheckTarget =
  | { mode: 'detection' }
  | { mode: 'default' }
  | { mode: 'species'; species: string; label: string };

/** Title, description and the "nothing verified" line for each target. */
function targetCopy(target: ThresholdCheckTarget) {
  switch (target.mode) {
    case 'detection':
      return {
        title: 'Check the detection threshold',
        description: 'How well the AI notices an animal, person or vehicle at each threshold, whatever the species, on the images people verified.',
        none: 'No animals, people or vehicles in the verified images yet.',
      };
    case 'default':
      return {
        title: 'Check the default classification threshold',
        description: 'How well the AI names the species that use the default at each threshold, on the images people verified. Common species weigh most here, so check a rare species on its own row.',
        none: 'No verified species that use the default yet, so there is nothing to suggest.',
      };
    case 'species':
      return {
        title: `Check the threshold for ${target.label}`,
        description: `How well the AI names ${target.label} at each threshold, on the images people verified.`,
        none: `No verified ${target.label} yet, so there is nothing to suggest.`,
      };
  }
}

interface ThresholdCheckDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  target: ThresholdCheckTarget;
  /** The slider's value now, saved or not. */
  current: number;
  onApply: (threshold: number) => void;
}

export function ThresholdCheckDialog({
  open,
  onClose,
  projectId,
  target,
  current,
  onApply,
}: ThresholdCheckDialogProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['threshold-check', projectId, target, current],
    queryFn: () => performanceApi.thresholdCheck(
      projectId,
      target.mode,
      current,
      target.mode === 'species' ? target.species : undefined,
    ),
    enabled: open,
    // Saved thresholds change the curve, so never show an old one.
    staleTime: 0,
  });

  const suggested = data?.suggested ?? null;
  const alreadyBest = suggested !== null && pct(suggested) === pct(current);

  const series = (key: 'precision' | 'recall' | 'f1') =>
    (data?.steps ?? []).map((s) => ({ x: s.threshold, y: s[key] }));
  const chartData: ChartData<'line', { x: number; y: number | null }[]> = {
    datasets: [
      { label: 'F1', data: series('f1'), borderColor: '#0f6064', backgroundColor: '#0f6064', borderWidth: 3, pointRadius: 2 },
      { label: 'Precision', data: series('precision'), borderColor: '#71b7ba', backgroundColor: '#71b7ba', borderWidth: 2, pointRadius: 0 },
      { label: 'Recall', data: series('recall'), borderColor: '#ff8945', backgroundColor: '#ff8945', borderWidth: 2, pointRadius: 0 },
    ],
  };

  const marker = (value: number, label: string, color: string, dashed: boolean) => ({
    type: 'line' as const,
    xMin: value,
    xMax: value,
    borderColor: color,
    borderWidth: 2,
    borderDash: dashed ? [6, 4] : undefined,
    label: { display: true, content: label, position: 'start' as const, backgroundColor: color, font: { size: 11 } },
  });
  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          title: (items) => `Threshold ${pct(items[0].parsed.x ?? 0)}`,
          label: (item) =>
            `${item.dataset.label} ${item.parsed.y === null ? 'none' : pct(item.parsed.y)}`,
        },
      },
      annotation: {
        annotations: {
          current: marker(current, 'Now', '#6b7280', true),
          ...(suggested !== null && !alreadyBest
            ? { best: marker(suggested, 'Best', '#0f6064', false) }
            : {}),
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: 1,
        title: { display: true, text: 'Threshold' },
        ticks: { callback: (v) => pct(Number(v)), stepSize: 0.1 },
        grid: { display: false },
      },
      y: {
        min: 0,
        max: 1,
        ticks: { callback: (v) => pct(Number(v)), stepSize: 0.25 },
      },
    },
  };

  const { title, description, none } = targetCopy(target);

  let verdict: string | null = null;
  if (data) {
    if (data.verified_images === 0) {
      verdict = 'No verified images yet. Verify some images first, then check again.';
    } else if (data.support === 0) {
      verdict = none;
    } else if (suggested === null) {
      verdict = `Only ${data.support} verified examples, at least ${data.min_support} are needed for a suggestion.`;
    } else if (alreadyBest) {
      verdict = `The current setting of ${pct(current)} already gives the best balance.`;
    } else {
      verdict = `Best balance at ${pct(suggested)}. Now set to ${pct(current)}.`;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">
            Could not compute the check. Try again later.
          </p>
        ) : data && data.verified_images > 0 ? (
          <div className="h-64">
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : null}

        {verdict && <p className="text-sm font-medium">{verdict}</p>}
        {data && data.verified_images > 0 && (
          <p className="text-xs text-muted-foreground">
            Precision is how often the AI is right when it says yes. Recall is
            how many of the real ones it finds. F1 balances the two. Based on{' '}
            {data.support} verified examples in {data.verified_images} verified
            images, so it is only as good as the images people chose to verify.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (suggested !== null) onApply(suggested);
              onClose();
            }}
            disabled={suggested === null || alreadyBest}
          >
            {suggested === null ? 'Use suggestion' : `Use ${pct(suggested)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
