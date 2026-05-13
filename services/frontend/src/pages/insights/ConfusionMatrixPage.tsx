/**
 * Insights -> Confusion matrix page.
 *
 * Pairs each verified image's top human species with its top AI prediction.
 * Diagonal = agreements, off-diagonal = mistakes. Click any non-zero cell to
 * open the underlying verified images in the Images tab.
 */
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Info, Loader2, Target } from 'lucide-react';

import { performanceApi, type PerformanceData } from '../../api/performance';
import { camerasApi } from '../../api/cameras';
import { statisticsApi } from '../../api/statistics';
import { Card, CardContent } from '../../components/ui/Card';
import {
  FilterBar,
  type DisplayControlDef,
  type FilterFieldDef,
  type FilterValue,
} from '../../components/ui/FilterBar';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { PerformanceSummaryCards } from '../../components/performance/PerformanceSummaryCards';
import { PlotExplainer } from '../../components/plots/PlotExplainer';
import { normalizeLabel } from '../../utils/labels';
import { gradientStyle } from '../../utils/performance-metrics';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

const OTHER_LABEL = 'other';

type MatrixMode = 'counts' | 'recall' | 'precision';

const TOP_N_VALUES: { value: string; label: string }[] = [
  { value: '10', label: '10 classes' },
  { value: '20', label: '20 classes' },
  { value: '50', label: '50 classes' },
  { value: 'all', label: 'All classes' },
];

const MODE_VALUES: { value: MatrixMode; label: string }[] = [
  { value: 'counts', label: 'Counts' },
  { value: 'recall', label: 'Recall (row %)' },
  { value: 'precision', label: 'Precision (column %)' },
];

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  camera_ids: 'string[]',
  top_n: 'string',
  mode: 'string',
};

const PCT = new Intl.NumberFormat('en', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatPct(value: number): string {
  const s = PCT.format(value);
  return s === '100.0%' ? '100%' : s;
}

const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';
const asStringArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : [];

interface FoldedMatrix {
  classes: string[];
  matrix: number[][];
  rowTotals: number[];
  colTotals: number[];
}

/**
 * Order classes by total appearances (row + col), keep the top N, and fold
 * the rest into a single "other" row + column so the totals stay
 * consistent. When `topN` is null, returns the full matrix in the original
 * order.
 */
function buildFoldedMatrix(data: PerformanceData, topN: number | null): FoldedMatrix {
  const { matrix_classes, matrix, matrix_row_totals, matrix_col_totals } = data;
  const order = matrix_classes
    .map((cls, idx) => ({
      cls,
      idx,
      freq: matrix_row_totals[idx] + matrix_col_totals[idx],
    }))
    .sort((a, b) => {
      if (b.freq !== a.freq) return b.freq - a.freq;
      return a.cls.localeCompare(b.cls);
    });

  if (topN === null || topN >= order.length) {
    return {
      classes: order.map((o) => o.cls),
      matrix: order.map(({ idx: r }) => order.map(({ idx: c }) => matrix[r][c])),
      rowTotals: order.map(({ idx: r }) => matrix_row_totals[r]),
      colTotals: order.map(({ idx: c }) => matrix_col_totals[c]),
    };
  }

  const topIndices = order.slice(0, topN).map((o) => o.idx);
  const otherIndices = order.slice(topN).map((o) => o.idx);
  const topClasses = order.slice(0, topN).map((o) => o.cls);

  // top × top quadrant
  const folded: number[][] = topIndices.map((r) =>
    topIndices.map((c) => matrix[r][c]),
  );
  // last column: each top row's spillover into "other"
  for (let i = 0; i < topIndices.length; i++) {
    const r = topIndices[i];
    let spill = 0;
    for (const c of otherIndices) spill += matrix[r][c];
    folded[i].push(spill);
  }
  // last row: each top col's incoming from "other"
  const otherRow: number[] = [];
  for (const c of topIndices) {
    let spill = 0;
    for (const r of otherIndices) spill += matrix[r][c];
    otherRow.push(spill);
  }
  // bottom-right cell: other-to-other
  let otherToOther = 0;
  for (const r of otherIndices) {
    for (const c of otherIndices) otherToOther += matrix[r][c];
  }
  otherRow.push(otherToOther);
  folded.push(otherRow);

  const rowTotals = folded.map((row) => row.reduce((s, v) => s + v, 0));
  const colTotals = folded[0].map((_, j) => folded.reduce((s, row) => s + row[j], 0));

  return {
    classes: [...topClasses, OTHER_LABEL],
    matrix: folded,
    rowTotals,
    colTotals,
  };
}

const Matrix: React.FC<{
  folded: FoldedMatrix;
  projectId: number;
  mode: MatrixMode;
}> = ({ folded, projectId, mode }) => {
  const navigate = useNavigate();

  const rowMaxes = folded.matrix.map((row) =>
    row.reduce((m, n) => (n > m ? n : m), 0),
  );

  const handleCellClick = (gtClass: string) => {
    if (gtClass === OTHER_LABEL) return;
    const params = new URLSearchParams();
    params.set('species', gtClass);
    params.set('verified', 'true');
    navigate(`/projects/${projectId}/images?${params.toString()}`);
  };

  if (folded.classes.length === 0) return null;

  const FIRST_COL_WIDTH = 7; // rem
  const CELL_SIZE = '2.25rem';
  const HEADER_HEIGHT = '9rem';
  const LABEL_MAX_LENGTH = '8.25rem';

  return (
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
            {folded.classes.map((cls) => (
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
                    color: cls === OTHER_LABEL ? 'var(--muted-foreground, #6b7280)' : undefined,
                    fontStyle: cls === OTHER_LABEL ? 'italic' : undefined,
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
          {folded.classes.map((cls, r) => (
            <tr key={cls} style={{ height: CELL_SIZE }}>
              <th
                className="sticky bg-background z-10 px-2 text-left font-medium border-r overflow-hidden text-ellipsis whitespace-nowrap"
                style={{
                  left: '0rem',
                  width: `${FIRST_COL_WIDTH}rem`,
                  maxWidth: `${FIRST_COL_WIDTH}rem`,
                  height: CELL_SIZE,
                  color: cls === OTHER_LABEL ? 'var(--muted-foreground, #6b7280)' : undefined,
                  fontStyle: cls === OTHER_LABEL ? 'italic' : undefined,
                }}
                title={normalizeLabel(cls)}
              >
                {normalizeLabel(cls)}
              </th>
              {folded.classes.map((predCls, c) => {
                const count = folded.matrix[r][c];
                const rowTotal = folded.rowTotals[r];
                const colTotal = folded.colTotals[c];
                const isZero = count === 0;
                const clickable = !isZero && cls !== OTHER_LABEL;

                // Mode-specific cell value and intensity. counts uses the
                // row-normalised count for intensity; recall uses the row
                // ratio (which is itself the intensity); precision uses the
                // column ratio.
                let ratio = 0;
                if (mode === 'recall' && rowTotal > 0) ratio = count / rowTotal;
                else if (mode === 'precision' && colTotal > 0) ratio = count / colTotal;
                const intensity =
                  mode === 'counts'
                    ? rowMaxes[r] > 0 ? count / rowMaxes[r] : 0
                    : ratio;
                const cellValue =
                  isZero
                    ? ''
                    : mode === 'counts'
                      ? count.toLocaleString()
                      : formatPct(ratio);
                const tooltipValue =
                  mode === 'counts'
                    ? `${count} verified image${count === 1 ? '' : 's'}`
                    : `${count} (${formatPct(ratio)} ${mode === 'recall' ? 'of row' : 'of column'})`;
                return (
                  <td
                    key={predCls}
                    className={`text-center tabular-nums border border-border/30 ${
                      clickable ? 'cursor-pointer hover:brightness-110' : ''
                    }`}
                    style={{
                      width: CELL_SIZE,
                      minWidth: CELL_SIZE,
                      maxWidth: CELL_SIZE,
                      height: CELL_SIZE,
                      ...gradientStyle(intensity),
                    }}
                    onClick={clickable ? () => handleCellClick(cls) : undefined}
                    title={
                      isZero
                        ? undefined
                        : `${normalizeLabel(cls)} → ${normalizeLabel(predCls)}: ${tooltipValue}${
                            clickable ? '. Click to open them in the Images tab.' : ''
                          }`
                    }
                  >
                    {cellValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const ConfusionMatrixPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);

  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);
  const cameraIdValues = asStringArray(parsed.camera_ids);
  const tagValues = asStringArray(parsed.tags);
  const startDate = asString(parsed.date_from);
  const endDate = asString(parsed.date_to);
  const topNRaw = asString(parsed.top_n);
  const topN: number | null = (() => {
    if (topNRaw === 'all') return null;
    if (topNRaw === '10' || topNRaw === '20' || topNRaw === '50') return Number(topNRaw);
    return 20;
  })();
  const topNValue: string =
    topNRaw === '10' || topNRaw === '20' || topNRaw === '50' || topNRaw === 'all'
      ? topNRaw
      : '20';
  const modeRaw = asString(parsed.mode);
  const mode: MatrixMode =
    modeRaw === 'recall' || modeRaw === 'precision' ? modeRaw : 'counts';

  const filterValues: Record<string, FilterValue> = {
    camera_ids: cameraIdValues.length > 0 ? cameraIdValues : undefined,
    tags: tagValues.length > 0 ? tagValues : undefined,
    date_from: startDate || undefined,
    date_to: endDate || undefined,
  };

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      top_n: topNValue === '20' ? undefined : topNValue,
      mode: mode === 'counts' ? undefined : mode,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), {
      replace: true,
    });
  };
  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () =>
    writeAll({
      camera_ids: undefined,
      tags: undefined,
      date_from: undefined,
      date_to: undefined,
    });
  const onDisplayChange = (key: string, value: string) => writeAll({ [key]: value });

  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectIdNum],
    queryFn: () => camerasApi.getAll(projectIdNum),
    enabled: !!projectIdNum,
  });
  const { data: tagOptions } = useQuery({
    queryKey: ['camera-tags', projectIdNum],
    queryFn: () => camerasApi.getTags(projectIdNum),
    enabled: !!projectIdNum,
  });
  const { data: overview } = useQuery({
    queryKey: ['statistics', 'overview', projectIdNum],
    queryFn: () => statisticsApi.getOverview(projectIdNum),
    enabled: !!projectIdNum,
  });

  // Union of cameras directly selected and cameras whose tags match.
  const cameraIdsParam = useMemo(() => {
    if (tagValues.length === 0 && cameraIdValues.length === 0) return undefined;
    const ids = new Set<string>(cameraIdValues);
    if (tagValues.length > 0 && cameras) {
      const tagSet = new Set(tagValues);
      for (const c of cameras) {
        if (c.tags?.some((tag) => tagSet.has(tag))) ids.add(String(c.id));
      }
    }
    return ids.size === 0 ? '0' : Array.from(ids).join(',');
  }, [tagValues, cameraIdValues, cameras]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['performance', projectIdNum, cameraIdsParam, startDate, endDate],
    queryFn: () =>
      performanceApi.get(projectIdNum, {
        camera_ids: cameraIdsParam,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      }),
    enabled: !!projectIdNum,
  });

  const filterFields = useMemo<FilterFieldDef[]>(
    () => [
      {
        kind: 'multi-select',
        key: 'camera_ids',
        label: 'Cameras',
        options: (cameras ?? []).map((c) => ({ label: c.name, value: String(c.id) })),
        placeholder: 'All cameras',
        summary: (n) => `${n} cameras`,
      },
      {
        kind: 'multi-select',
        key: 'tags',
        label: 'Camera tags',
        options: (tagOptions ?? []).map((t) => ({ label: t, value: t })),
        placeholder: 'Any tags',
        summary: (n) => `${n} tags`,
      },
      {
        kind: 'date-range',
        fromKey: 'date_from',
        toKey: 'date_to',
        label: 'Date range',
        minDate: overview?.first_image_date,
        maxDate: overview?.last_image_date,
      },
    ],
    [cameras, tagOptions, overview],
  );

  const displayControls = useMemo<DisplayControlDef[]>(
    () => [
      {
        key: 'mode',
        label: 'Cell values',
        options: MODE_VALUES,
      },
      {
        key: 'top_n',
        label: 'Show top',
        options: TOP_N_VALUES,
      },
    ],
    [],
  );

  const displayValues: Record<string, string> = { top_n: topNValue, mode };

  const folded = useMemo<FoldedMatrix | null>(() => {
    if (!data) return null;
    return buildFoldedMatrix(data, topN);
  }, [data, topN]);

  // Project name (referenced for the empty state header copy and the
  // subtitle to keep matching the rest of the Insights pages).
  const subtitle = 'Top-1 human species vs top-1 AI prediction across verified images';

  return (
    <InsightsPageLayout title="Confusion matrix" subtitle={subtitle}>
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
        displayControls={displayControls}
        displayValues={displayValues}
        onDisplayChange={onDisplayChange}
      />

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
            <p className="text-muted-foreground text-sm">No verified images match the filters</p>
            <p className="text-muted-foreground text-xs mt-1">
              Verify some images on the Images page or widen the filters above.
            </p>
          </CardContent>
        </Card>
      ) : folded === null ? null : (
        <>
          <PerformanceSummaryCards data={data} />
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <Matrix folded={folded} projectId={projectIdNum} mode={mode} />
            <div className="border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>Based on {data.total_verified_images.toLocaleString()} verified image{data.total_verified_images === 1 ? '' : 's'}</span>
              <span aria-hidden="true">·</span>
              <span>{folded.classes.length} class{folded.classes.length === 1 ? '' : 'es'} shown</span>
              {topN !== null && data.matrix_classes.length > topN && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{data.matrix_classes.length - topN} folded into "other"</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Click any non-zero cell to open the underlying images</span>
            </div>
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
            Cell colour scales per row from pale teal (low) to dark teal (high), so the dominant
            prediction for each true class stands out. Click any non-zero cell to open the
            underlying verified images. Cells involving <em>empty</em>, <em>person</em>, or{' '}
            <em>vehicle</em> reflect detection errors rather than classification errors. When the
            class list is truncated, the smaller classes fold into an <em>other</em> row and
            column so the totals still add up.
          </p>
        }
      />
    </InsightsPageLayout>
  );
};
