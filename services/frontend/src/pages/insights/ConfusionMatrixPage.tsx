/**
 * Insights -> Confusion matrix page.
 *
 * Pairs each verified image's top human species with its top AI prediction.
 * Diagonal = agreements, off-diagonal = mistakes. Click any non-zero cell to
 * open the underlying verified images in the Images tab.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, Target } from 'lucide-react';

import { performanceApi, type PerformanceData } from '../../api/performance';
import { Card, CardContent } from '../../components/ui/Card';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { PerformanceSummaryCards } from '../../components/performance/PerformanceSummaryCards';
import { PlotExplainer, type PlotReference } from '../../components/plots/PlotExplainer';
import { normalizeLabel } from '../../utils/labels';
import { gradientStyle } from '../../utils/performance-metrics';

const TOP_N_OPTIONS: { value: number | null; label: string }[] = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: null, label: 'all' },
];

const REFERENCES: PlotReference[] = [
  {
    citation:
      'Sokolova, M., & Lapalme, G. (2009). A systematic analysis of performance measures for ' +
      'classification tasks. Information Processing & Management, 45(4), 427–437.',
    url: 'https://doi.org/10.1016/j.ipm.2009.03.002',
  },
];

const Matrix: React.FC<{ data: PerformanceData; projectId: number }> = ({ data, projectId }) => {
  const { matrix_classes, matrix, matrix_row_totals, matrix_col_totals } = data;
  const navigate = useNavigate();
  const [topN, setTopN] = useState<number | null>(20);

  const classOrder = useMemo(() => {
    return matrix_classes
      .map((cls, idx) => ({
        cls,
        idx,
        freq: matrix_row_totals[idx] + matrix_col_totals[idx],
      }))
      .sort((a, b) => {
        if (b.freq !== a.freq) return b.freq - a.freq;
        return a.cls.localeCompare(b.cls);
      });
  }, [matrix_classes, matrix_row_totals, matrix_col_totals]);

  const visibleClasses = topN === null ? classOrder : classOrder.slice(0, topN);

  const rowMaxes = visibleClasses.map(({ idx: r }) => {
    let max = 0;
    for (const { idx: c } of visibleClasses) {
      if (matrix[r][c] > max) max = matrix[r][c];
    }
    return max;
  });

  const handleCellClick = (gtClass: string) => {
    const params = new URLSearchParams();
    params.set('species', gtClass);
    params.set('verified', 'true');
    navigate(`/projects/${projectId}/images?${params.toString()}`);
  };

  if (matrix_classes.length === 0) {
    return null;
  }

  const FIRST_COL_WIDTH = 7; // rem
  const CELL_SIZE = '2.25rem';
  const HEADER_HEIGHT = '9rem';
  const LABEL_MAX_LENGTH = '8.25rem';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Show top</span>
        <select
          value={topN === null ? 'all' : String(topN)}
          onChange={(e) => setTopN(e.target.value === 'all' ? null : Number(e.target.value))}
          className="border border-input rounded-md px-2 py-1 text-sm bg-background"
        >
          {TOP_N_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value === null ? 'all' : String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">classes by frequency</span>
      </div>

      <div className="block max-w-full max-h-[70vh] overflow-auto border border-input rounded-md">
        <table className="text-xs border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th
                className="sticky bg-background z-30 border-b border-r"
                style={{
                  left: '0rem',
                  top: '0rem',
                  height: HEADER_HEIGHT,
                  width: `${FIRST_COL_WIDTH}rem`,
                }}
              />
              {visibleClasses.map(({ cls }) => (
                <th
                  key={cls}
                  className="sticky bg-background z-20 align-bottom border-b font-medium p-0"
                  style={{
                    top: '0rem',
                    height: HEADER_HEIGHT,
                    width: CELL_SIZE,
                    minWidth: CELL_SIZE,
                    maxWidth: CELL_SIZE,
                  }}
                >
                  <div
                    className="overflow-hidden text-ellipsis whitespace-nowrap mx-auto"
                    style={{
                      writingMode: 'vertical-rl',
                      transform: 'rotate(180deg)',
                      maxHeight: LABEL_MAX_LENGTH,
                      paddingTop: '0.25rem',
                      paddingBottom: '0.25rem',
                    }}
                    title={normalizeLabel(cls)}
                  >
                    {normalizeLabel(cls)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleClasses.map(({ cls, idx: r }, rowIdx) => (
              <tr key={cls} style={{ height: CELL_SIZE }}>
                <th
                  className="sticky bg-background z-10 px-2 text-left font-medium border-r overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{
                    left: '0rem',
                    width: `${FIRST_COL_WIDTH}rem`,
                    maxWidth: `${FIRST_COL_WIDTH}rem`,
                    height: CELL_SIZE,
                  }}
                  title={normalizeLabel(cls)}
                >
                  {normalizeLabel(cls)}
                </th>
                {visibleClasses.map(({ idx: c, cls: predCls }) => {
                  const count = matrix[r][c];
                  const isZero = count === 0;
                  return (
                    <td
                      key={predCls}
                      className={`text-center tabular-nums border border-border/30 ${
                        isZero ? '' : 'cursor-pointer hover:brightness-110'
                      }`}
                      style={{
                        width: CELL_SIZE,
                        minWidth: CELL_SIZE,
                        maxWidth: CELL_SIZE,
                        height: CELL_SIZE,
                        ...gradientStyle(rowMaxes[rowIdx] > 0 ? count / rowMaxes[rowIdx] : 0),
                      }}
                      onClick={isZero ? undefined : () => handleCellClick(cls)}
                      title={
                        isZero
                          ? undefined
                          : `${count} verified images where humans saw ${normalizeLabel(cls)} and the AI predicted ${normalizeLabel(predCls)}. Click to open them in the Images tab.`
                      }
                    >
                      {isZero ? '' : count}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const ConfusionMatrixPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);

  const { data, isLoading, error } = useQuery({
    queryKey: ['performance', projectIdNum],
    queryFn: () => performanceApi.get(projectIdNum),
    enabled: !!projectIdNum,
  });

  return (
    <InsightsPageLayout
      title="Confusion matrix"
      subtitle="Top-1 human species vs top-1 AI prediction across verified images"
    >
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
        <>
          <PerformanceSummaryCards data={data} />
          <div className="rounded-lg border bg-card p-4">
            <Matrix data={data} projectId={projectIdNum} />
          </div>
        </>
      )}

      <PlotExplainer
        plotKey="confusion-matrix"
        what={
          <p>
            Each verified image contributes one cell. The row is the human top-1 species (the
            species with the highest count in that image, or empty when no animals were verified).
            The column is the AI top-1 (the highest-confidence visible classification, or empty
            when no detections were above threshold). The diagonal is agreements, off-diagonal
            cells are mistakes.
          </p>
        }
        how={
          <p>
            Cell colour scales per row from light yellow (low) to dark teal (high), so the
            dominant prediction for each true class stands out. Click any non-zero cell to open
            the underlying verified images in the Images tab. Cells involving <em>empty</em>,{' '}
            <em>person</em>, or <em>vehicle</em> reflect detection errors rather than
            classification errors, since detection is what decides whether an image is empty or
            shows a person or vehicle.
          </p>
        }
        caveats={
          <p>
            Multi-species images are attributed to their most-numerous species on each side, so a
            frame with three deer and one fox lands in the deer row. Per-class precision, recall,
            and F1 derived from this matrix live on the Per-class performance page.
          </p>
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};
