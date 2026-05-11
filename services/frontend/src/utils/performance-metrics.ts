/**
 * Performance metrics helpers shared by the Confusion matrix and Per-class
 * performance Insights pages.
 *
 * `computeDetailedMetrics` builds the per-class precision / recall / F1 plus
 * macro / weighted averages from the backend's confusion matrix in a single
 * pass. `gradientStyle` is the teal-to-yellow heat scale used by both the
 * matrix cells and the F1 column.
 */
import type { PerformanceData } from '../api/performance';

export interface ClassMetrics {
  species: string;
  support: number;        // # of verified images where this class is the human top-1
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface DetailedMetrics {
  perClass: ClassMetrics[];
  macroP: number | null;
  macroR: number | null;
  macroF1: number | null;
  weightedP: number | null;
  weightedR: number | null;
  weightedF1: number | null;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// Brand gradient from FRONTEND_CONVENTIONS.md: dark teal (high) to light
// yellow (low).
const GRADIENT_HIGH = { r: 0x0f, g: 0x60, b: 0x64 }; // #0f6064
const GRADIENT_LOW = { r: 0xf9, g: 0xf8, b: 0x71 };  // #f9f871

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function gradientStyle(t: number): React.CSSProperties {
  if (t <= 0) return {};
  const clamped = Math.max(0, Math.min(1, t));
  const r = lerp(GRADIENT_LOW.r, GRADIENT_HIGH.r, clamped);
  const g = lerp(GRADIENT_LOW.g, GRADIENT_HIGH.g, clamped);
  const b = lerp(GRADIENT_LOW.b, GRADIENT_HIGH.b, clamped);
  return {
    backgroundColor: `rgb(${r}, ${g}, ${b})`,
    // Flip text colour to white once the background gets dark enough that
    // the default near-black foreground washes out.
    color: clamped > 0.55 ? '#ffffff' : '#1f2937',
  };
}

export function computeDetailedMetrics(data: PerformanceData): DetailedMetrics {
  const perClass: ClassMetrics[] = data.matrix_classes.map((cls, i) => {
    const tp = data.matrix[i][i];
    const support = data.matrix_row_totals[i];
    const colTotal = data.matrix_col_totals[i];
    const precision = colTotal > 0 ? tp / colTotal : null;
    const recall = support > 0 ? tp / support : null;
    const f1 =
      precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    return { species: cls, support, precision, recall, f1 };
  });

  // Drop classes with no signal at all.
  const present = perClass.filter((c) => c.support > 0 || (c.precision !== null && c.precision >= 0));

  // Macro: simple mean across present classes, ignoring nulls.
  const validP = present.filter((c) => c.precision !== null);
  const validR = present.filter((c) => c.recall !== null);
  const validF1 = present.filter((c) => c.f1 !== null);
  const mean = (xs: number[]): number | null => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const macroP = mean(validP.map((c) => c.precision as number));
  const macroR = mean(validR.map((c) => c.recall as number));
  const macroF1 = mean(validF1.map((c) => c.f1 as number));

  // Weighted: weighted by support.
  const totalSupport = present.reduce((s, c) => s + c.support, 0);
  const weighted = (key: 'precision' | 'recall' | 'f1'): number | null => {
    if (totalSupport === 0) return null;
    let acc = 0;
    let weight = 0;
    for (const c of present) {
      const v = c[key];
      if (v === null) continue;
      acc += v * c.support;
      weight += c.support;
    }
    return weight > 0 ? acc / weight : null;
  };

  return {
    perClass: present,
    macroP,
    macroR,
    macroF1,
    weightedP: weighted('precision'),
    weightedR: weighted('recall'),
    weightedF1: weighted('f1'),
  };
}
