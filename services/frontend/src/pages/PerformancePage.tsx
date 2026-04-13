/**
 * Performance page: per-project AI vs human evaluation.
 *
 * Two views from a single backend pass over verified images:
 * - Aggregate: per-species instance counts (human total vs AI total).
 * - Confusion matrix: image-level top-1 pairing, with empty/person/vehicle
 *   included as classes.
 */
import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Target } from 'lucide-react';
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

const AggregateCard: React.FC<{ rows: PerformanceData['aggregate'] }> = ({ rows }) => (
  <Card>
    <CardContent className="py-4">
      <h2 className="text-sm font-semibold mb-3">Per-species counts (instance level)</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No species observed yet.</p>
      ) : (
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
      )}
    </CardContent>
  </Card>
);

const MatrixCard: React.FC<{ data: PerformanceData }> = ({ data }) => {
  const { matrix_classes, matrix, matrix_row_totals, matrix_col_totals } = data;
  if (matrix_classes.length === 0) {
    return null;
  }
  const rowMaxes = matrix.map((row) => Math.max(...row, 0));

  return (
    <Card>
      <CardContent className="py-4">
        <h2 className="text-sm font-semibold mb-3">Confusion matrix (image-level top-1)</h2>
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
      </CardContent>
    </Card>
  );
};

const FootnoteCard: React.FC = () => (
  <Card>
    <CardContent className="py-4 space-y-2 text-xs text-muted-foreground">
      <p>
        The aggregate table counts individual instances (sum of human observation counts and visible AI detections).
        The matrix pairs each image to its top-1 species on each side.
      </p>
      <p>
        Cells involving <em>empty</em>, <em>person</em>, or <em>vehicle</em> in the matrix reflect detection errors
        rather than classification errors, since detection is what decides whether an image is empty or shows a person
        or vehicle.
      </p>
      <p>
        Multi-species images are counted fully in the aggregate but attributed to their most-numerous species in the matrix.
      </p>
    </CardContent>
  </Card>
);

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
          <AggregateCard rows={data.aggregate} />
          <MatrixCard data={data} />
          <FootnoteCard />
        </div>
      )}
    </div>
  );
};
