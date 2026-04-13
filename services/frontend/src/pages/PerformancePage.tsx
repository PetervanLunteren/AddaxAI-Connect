/**
 * Performance page: per-project AI vs human evaluation.
 *
 * Two views from a single backend pass over verified images:
 * - Aggregate: per-species instance counts (human total vs AI total).
 * - Confusion matrix: image-level top-1 pairing, with empty/person/vehicle
 *   included as classes.
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Target } from 'lucide-react';
import { performanceApi, type PerformanceData } from '../api/performance';
import { Card, CardContent } from '../components/ui/Card';
import { normalizeLabel } from '../utils/labels';

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function diffStyle(diff: number, humanCount: number): React.CSSProperties {
  if (diff === 0) return {};
  // Relative bias: how off is the AI vs the human ground truth.
  const ref = Math.max(humanCount, 1);
  const ratio = Math.abs(diff) / ref;
  // Green for < 5% off, amber up to 25% off, red beyond.
  if (ratio < 0.05) return { color: '#0f6064' };
  if (ratio < 0.25) return { color: '#b45309' }; // amber-700
  return { color: '#882000' };
}

function cellStyle(count: number, rowMax: number, isDiagonal: boolean): React.CSSProperties {
  if (count === 0) return {};
  const intensity = rowMax > 0 ? count / rowMax : 0;
  const alpha = 0.1 + intensity * 0.5; // 0.1..0.6
  const base = isDiagonal ? '15, 96, 100' : '136, 32, 0';
  return { backgroundColor: `rgba(${base}, ${alpha})` };
}

interface ClassMetrics {
  species: string;
  support: number;     // # of verified images where this class is the human top-1
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

interface DetailedMetrics {
  perClass: ClassMetrics[];
  macroP: number | null;
  macroR: number | null;
  macroF1: number | null;
  weightedP: number | null;
  weightedR: number | null;
  weightedF1: number | null;
  micro: number;  // = matrix accuracy in single-label multiclass
}

function computeDetailedMetrics(data: PerformanceData): DetailedMetrics {
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

  // Drop classes with no signal at all (no support and no predictions).
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
    micro: data.matrix_accuracy,
  };
}

const CollapsibleCard: React.FC<{
  title: string;
  caption?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, caption, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 px-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {caption && <p className="text-xs text-muted-foreground mt-0.5">{caption}</p>}
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {open && <CardContent className="pt-0 pb-4">{children}</CardContent>}
    </Card>
  );
};

const HeadlineCard: React.FC<{ data: PerformanceData }> = ({ data }) => (
  <Card>
    <CardContent className="py-6">
      <div className="flex items-baseline gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Verified images</p>
          <p className="text-3xl font-bold tabular-nums">{data.total_verified_images}</p>
        </div>
        <div className="border-l border-border pl-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Top-1 matrix accuracy</p>
          <p className="text-3xl font-bold tabular-nums">{formatPercent(data.matrix_accuracy)}</p>
          <p className="text-xs text-muted-foreground">
            {data.matrix_correct} of {data.total_verified_images} verified images
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
);

const AggregateContent: React.FC<{ rows: PerformanceData['aggregate'] }> = ({ rows }) => {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No species observed yet.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr>
              <th className="text-left py-2 pr-4 font-medium">Species</th>
              <th className="text-right py-2 px-4 font-medium">Human</th>
              <th className="text-right py-2 px-4 font-medium">AI</th>
              <th className="text-right py-2 pl-4 font-medium">Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.species} className="border-b border-border/50">
                <td className="py-1.5 pr-4">{normalizeLabel(row.species)}</td>
                <td className="py-1.5 px-4 text-right tabular-nums">{row.human_count}</td>
                <td className="py-1.5 px-4 text-right tabular-nums">{row.ai_count}</td>
                <td
                  className="py-1.5 pl-4 text-right tabular-nums font-medium"
                  style={diffStyle(row.diff, row.human_count)}
                >
                  {row.diff > 0 ? '+' : ''}
                  {row.diff}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        For every verified image, human observation counts are summed and visible AI detections are counted.
        Multi-species images contribute in full on both sides, so a frame with three deer and one fox adds
        three to the human deer total and one to the human fox total. The diff column is colored: green when
        the AI count is within 5% of the human count, amber up to 25% off, red beyond. A negative diff means
        the AI is under-counting, a positive diff means it is over-counting. Mistakes can cancel out across
        images at this aggregate level: an image where the AI said deer instead of fox and another where it
        said fox instead of deer both look perfect in this table. Open the confusion matrix below to see
        directional mix-ups.
      </p>
    </div>
  );
};

const MatrixContent: React.FC<{ data: PerformanceData }> = ({ data }) => {
  const { matrix_classes, matrix, matrix_row_totals, matrix_col_totals } = data;
  if (matrix_classes.length === 0) {
    return null;
  }
  const rowMaxes = matrix.map((row) => Math.max(...row, 0));

  return (
    <div className="space-y-3">
      <div className="overflow-auto max-h-[70vh]">
        <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 bg-background z-20 p-1 text-muted-foreground font-normal">
              Human ↓ / AI →
            </th>
            {matrix_classes.map((cls, c) => {
              const colTotal = matrix_col_totals[c];
              const precision = colTotal > 0 ? matrix[c][c] / colTotal : null;
              return (
                <th
                  key={cls}
                  className="sticky top-0 bg-background z-10 p-1 align-bottom border-b"
                >
                  <div className="text-foreground font-medium whitespace-nowrap">
                    {normalizeLabel(cls)}
                  </div>
                  <div className="text-muted-foreground tabular-nums">
                    P: {precision === null ? '—' : formatPercent(precision)}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {matrix_classes.map((cls, r) => {
            const rowTotal = matrix_row_totals[r];
            const recall = rowTotal > 0 ? matrix[r][r] / rowTotal : null;
            return (
              <tr key={cls}>
                <th className="sticky left-0 bg-background z-10 p-1 text-left border-r">
                  <div className="text-foreground font-medium whitespace-nowrap">
                    {normalizeLabel(cls)}
                  </div>
                  <div className="text-muted-foreground tabular-nums">
                    R: {recall === null ? '—' : formatPercent(recall)}
                  </div>
                </th>
                {matrix_classes.map((_, c) => {
                  const count = matrix[r][c];
                  const isDiagonal = r === c;
                  return (
                    <td
                      key={c}
                      className="p-1 text-center tabular-nums border border-border/30"
                      style={cellStyle(count, rowMaxes[r], isDiagonal)}
                      title={`Human: ${normalizeLabel(matrix_classes[r])}, AI: ${normalizeLabel(matrix_classes[c])}, count: ${count}`}
                    >
                      {count === 0 ? <span className="text-muted-foreground/30">·</span> : count}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Each verified image contributes one cell. The row is the human top-1 species (the species with the
        highest count in that image, or empty when no animals were verified). The column is the AI top-1 (the
        highest-confidence visible classification, or empty when no detections were above threshold). Diagonal
        cells are correct, off-diagonal cells are mistakes. The number under each column header (P:) is
        precision: of all images where the AI guessed this class, what fraction were actually this class. The
        number under each row header (R:) is recall: of all images that actually were this class, what fraction
        the AI caught. Cells involving <em>empty</em>, <em>person</em>, or <em>vehicle</em> reflect detection
        errors rather than classification errors, since detection is what decides whether an image is empty or
        shows a person or vehicle. Multi-species images are attributed to their most-numerous species on each side.
      </p>
    </div>
  );
};

const MetricsContent: React.FC<{ data: PerformanceData }> = ({ data }) => {
  const m = computeDetailedMetrics(data);
  if (m.perClass.length === 0) {
    return <p className="text-sm text-muted-foreground">Not enough data yet.</p>;
  }
  const fmt = (v: number | null) => (v === null ? '—' : formatPercent(v));
  return (
    <div className="space-y-3">
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr>
              <th className="text-left py-2 pr-4 font-medium">Class</th>
              <th className="text-right py-2 px-4 font-medium">Support</th>
              <th className="text-right py-2 px-4 font-medium">Precision</th>
              <th className="text-right py-2 px-4 font-medium">Recall</th>
              <th className="text-right py-2 pl-4 font-medium">F1</th>
            </tr>
          </thead>
          <tbody>
            {m.perClass.map((c) => (
              <tr key={c.species} className="border-b border-border/50">
                <td className="py-1.5 pr-4">{normalizeLabel(c.species)}</td>
                <td className="py-1.5 px-4 text-right tabular-nums">{c.support}</td>
                <td className="py-1.5 px-4 text-right tabular-nums">{fmt(c.precision)}</td>
                <td className="py-1.5 px-4 text-right tabular-nums">{fmt(c.recall)}</td>
                <td className="py-1.5 pl-4 text-right tabular-nums">{fmt(c.f1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border">
            <tr>
              <td className="py-1.5 pr-4 font-medium">Macro avg</td>
              <td className="py-1.5 px-4" />
              <td className="py-1.5 px-4 text-right tabular-nums font-medium">{fmt(m.macroP)}</td>
              <td className="py-1.5 px-4 text-right tabular-nums font-medium">{fmt(m.macroR)}</td>
              <td className="py-1.5 pl-4 text-right tabular-nums font-medium">{fmt(m.macroF1)}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 font-medium">Weighted avg</td>
              <td className="py-1.5 px-4" />
              <td className="py-1.5 px-4 text-right tabular-nums font-medium">{fmt(m.weightedP)}</td>
              <td className="py-1.5 px-4 text-right tabular-nums font-medium">{fmt(m.weightedR)}</td>
              <td className="py-1.5 pl-4 text-right tabular-nums font-medium">{fmt(m.weightedF1)}</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-4 font-medium">Micro avg</td>
              <td className="py-1.5 px-4" />
              <td className="py-1.5 px-4 text-right tabular-nums font-medium" colSpan={3}>
                {fmt(m.micro)}
                <span className="text-muted-foreground font-normal text-xs ml-2">(= overall accuracy)</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>Support</strong> is the number of verified images where this class is the human top-1 (the
        &ldquo;ground truth&rdquo;). <strong>Precision</strong> is of all the images where the AI predicted this
        class, what fraction were actually this class. <strong>Recall</strong> is of all the images that actually
        were this class, what fraction the AI caught. <strong>F1</strong> is the harmonic mean of precision and
        recall (a single balanced score). <strong>Macro avg</strong> averages each metric across classes equally;
        <strong> weighted avg</strong> weights by support (so common species count more); <strong>micro avg</strong>
        aggregates across classes and equals overall accuracy in this single-label setup.
      </p>
    </div>
  );
};

export const PerformancePage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);

  const { data, isLoading, error } = useQuery({
    queryKey: ['performance', projectIdNum],
    queryFn: () => performanceApi.get(projectIdNum),
    enabled: !!projectIdNum,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-0">Performance</h1>
        <p className="text-sm text-gray-600 mt-1">
          How well the AI agrees with human verifications across this project
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error || !data ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-sm">Unable to load performance data</p>
          </CardContent>
        </Card>
      ) : data.total_verified_images === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-sm">No verified images yet</p>
            <p className="text-muted-foreground text-xs mt-1">
              Verify some images on the Images page to start seeing AI vs human comparisons here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <HeadlineCard data={data} />
          <CollapsibleCard
            title="Per-species counts"
            caption="Compares total AI detections against human verifications per species, to spot systematic over- or under-counting."
          >
            <AggregateContent rows={data.aggregate} />
          </CollapsibleCard>
          <CollapsibleCard
            title="Confusion matrix"
            caption="Pairs each verified image's top human species with its top AI prediction, so the diagonal shows agreements and the off-diagonal cells show exactly which species the AI confuses for which."
          >
            <MatrixContent data={data} />
          </CollapsibleCard>
          <CollapsibleCard
            title="Detailed metrics"
            caption="Per-class precision, recall, and F1 derived from the confusion matrix, plus macro, weighted, and micro averages across all classes for a single overall score."
          >
            <MetricsContent data={data} />
          </CollapsibleCard>
        </div>
      )}
    </div>
  );
};
