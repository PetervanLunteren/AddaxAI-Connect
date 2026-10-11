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
import { DETECTOR_CATEGORIES, normalizeLabel } from './labels';

/**
 * Options for the Labels filter: every class in the data, plus any label
 * already selected that the data no longer holds (a narrower date range).
 * Without the second part a selected label would vanish from the control,
 * which then reads "All labels" while the filter still narrows the page.
 */
export function labelFilterOptions(
  data: PerformanceData | undefined,
  selected: string[],
): { label: string; value: string }[] {
  const present = (data?.matrix_classes ?? []).filter(
    (_, i) => data!.matrix_row_totals[i] > 0 || data!.matrix_col_totals[i] > 0,
  );
  const all = [...present, ...selected.filter((s) => !present.includes(s))];
  return all.map((cls) => ({ label: normalizeLabel(cls), value: cls }));
}

/**
 * Link to the verified images behind a number on a performance page, carrying
 * the page's own date range and site filter, so the images match the number
 * that was clicked. `extra` holds what the clicked row or cell adds.
 */
export function performanceImagesUrl(
  projectId: number,
  scope: { siteIds?: string; dateFrom?: string; dateTo?: string },
  extra: Record<string, string>,
): string {
  const params = new URLSearchParams(extra);
  params.set('verified', 'true');
  if (scope.siteIds && !params.has('site_id')) params.set('site_id', scope.siteIds);
  if (scope.dateFrom) params.set('date_from', scope.dateFrom);
  if (scope.dateTo) params.set('date_to', scope.dateTo);
  return `/projects/${projectId}/images?${params.toString()}`;
}

export interface ClassMetrics {
  species: string;
  support: number;        // # of verified subjects a person recorded as this class
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

/**
 * Narrow the performance data to the selected labels, the same mental model
 * as the Labels filter on the Images page. An empty selection means all.
 *
 * A subject stays when the person or the AI named a selected class, so a
 * selected class keeps its misses (its row) and its false alarms (its
 * column), and its precision and recall do not change with the selection.
 * Only subjects where both sides name a deselected class drop out. That
 * keeps the original use: a validator who retypes mustelids as pine marten
 * deselects both classes and reads the AI's performance on everything else.
 * The partner classes (empty, a species the AI confused it with) stay in
 * the matrix; per-class rows and averages cover the selection only, through
 * selected_classes. The by-site table is computed on the server and passes
 * through unchanged.
 */
export function filterPerformanceClasses(
  data: PerformanceData,
  selected: string[],
): PerformanceData {
  if (selected.length === 0) return data;
  const keep = new Set(selected);
  const kept = data.matrix.map((row, r) =>
    row.map((v, c) =>
      keep.has(data.matrix_classes[r]) || keep.has(data.matrix_classes[c]) ? v : 0,
    ),
  );
  const rowSum = (r: number) => kept[r].reduce((s, v) => s + v, 0);
  const colSum = (c: number) => kept.reduce((s, row) => s + row[c], 0);
  const indices = data.matrix_classes
    .map((_, idx) => idx)
    .filter((idx) => rowSum(idx) > 0 || colSum(idx) > 0);

  const matrix = indices.map((r) => indices.map((c) => kept[r][c]));
  const rowTotals = matrix.map((row) => row.reduce((s, v) => s + v, 0));
  const colTotals = indices.map((_, j) =>
    matrix.reduce((s, row) => s + row[j], 0),
  );
  const correct = matrix.reduce((s, row, i) => s + row[i], 0);
  const subjects = rowTotals.reduce((s, v) => s + v, 0);

  return {
    ...data,
    aggregate: data.aggregate.filter((row) => keep.has(row.species)),
    matrix_classes: indices.map((idx) => data.matrix_classes[idx]),
    matrix,
    matrix_row_totals: rowTotals,
    matrix_col_totals: colTotals,
    matrix_correct: correct,
    matrix_accuracy: subjects > 0 ? correct / subjects : 0,
    matrix_subjects: subjects,
    selected_classes: selected,
  };
}

/** True when the class gets its own per-class row: no Labels filter, or
 * the filter selected it. */
export function isShownClass(data: PerformanceData, cls: string): boolean {
  return !data.selected_classes || data.selected_classes.includes(cls);
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

  // Drop classes with no signal at all, and the partner classes a Labels
  // filter keeps only for the matrix.
  const present = perClass.filter(
    (c) => (c.support > 0 || c.precision !== null) && isShownClass(data, c.species),
  );
  // Averages cover the classifier's classes only. Empty, person and vehicle
  // are detector categories, kept in perClass but not averaged, the same
  // rule as the Per-class performance table.
  const averaged = present.filter((c) => !DETECTOR_CATEGORIES.has(c.species));

  // Macro: simple mean across averaged classes, ignoring nulls.
  const validP = averaged.filter((c) => c.precision !== null);
  const validR = averaged.filter((c) => c.recall !== null);
  const validF1 = averaged.filter((c) => c.f1 !== null);
  const mean = (xs: number[]): number | null => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const macroP = mean(validP.map((c) => c.precision as number));
  const macroR = mean(validR.map((c) => c.recall as number));
  const macroF1 = mean(validF1.map((c) => c.f1 as number));

  // Weighted: weighted by support.
  const totalSupport = averaged.reduce((s, c) => s + c.support, 0);
  const weighted = (key: 'precision' | 'recall' | 'f1'): number | null => {
    if (totalSupport === 0) return null;
    let acc = 0;
    let weight = 0;
    for (const c of averaged) {
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
