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

// Single-hue teal intensity ramp matching AddaxAI WebUI's matrixCellColor.
// Low end is a pale teal so faint cells stay readable; high end is the
// brand teal #0f6064. F1 column reuses the same ramp.
const TEAL_LOW = { r: 0xe3, g: 0xf0, b: 0xf0 };  // #e3f0f0
const TEAL_HIGH = { r: 0x0f, g: 0x60, b: 0x64 }; // #0f6064

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function gradientStyle(t: number): React.CSSProperties {
  if (t <= 0) return {};
  const clamped = Math.max(0, Math.min(1, t));
  const r = lerp(TEAL_LOW.r, TEAL_HIGH.r, clamped);
  const g = lerp(TEAL_LOW.g, TEAL_HIGH.g, clamped);
  const b = lerp(TEAL_LOW.b, TEAL_HIGH.b, clamped);
  return {
    backgroundColor: `rgb(${r}, ${g}, ${b})`,
    // Flip text colour to white once the background gets dark enough that
    // the default near-black foreground washes out.
    color: clamped > 0.55 ? '#ffffff' : '#1f2937',
  };
}

// Diverging palette for the F1 column on Per-class performance: F1 ranges
// [0, 1] where 0 is bad and 1 is good, so a single-hue ramp under-
// communicates the meaning. Mirrors AddaxAI WebUI's f1DivergingColor:
// red (#882000) → mid teal (#71b7ba) → dark teal (#0f6064). Aligns with
// the project status palette so the colour is visually consistent.
const STATUS_BAD = { r: 0x88, g: 0x20, b: 0x00 };
const STATUS_MID = { r: 0x71, g: 0xb7, b: 0xba };
const STATUS_GOOD = { r: 0x0f, g: 0x60, b: 0x64 };

export function f1DivergingColor(value: number | null): React.CSSProperties {
  if (value === null) return {};
  const clamped = Math.max(0, Math.min(1, value));
  // First half blends BAD → MID; second half blends MID → GOOD.
  let r: number;
  let g: number;
  let b: number;
  if (clamped < 0.5) {
    const t = clamped * 2;
    r = lerp(STATUS_BAD.r, STATUS_MID.r, t);
    g = lerp(STATUS_BAD.g, STATUS_MID.g, t);
    b = lerp(STATUS_BAD.b, STATUS_MID.b, t);
  } else {
    const t = (clamped - 0.5) * 2;
    r = lerp(STATUS_MID.r, STATUS_GOOD.r, t);
    g = lerp(STATUS_MID.g, STATUS_GOOD.g, t);
    b = lerp(STATUS_MID.b, STATUS_GOOD.b, t);
  }
  // Black text near the mid teal, white text near both ends.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return {
    backgroundColor: `rgb(${r}, ${g}, ${b})`,
    color: lum > 0.55 ? '#1f2937' : '#ffffff',
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
