/**
 * Insights -> Performance page.
 *
 * Per-class precision, recall, F1, plus macro and weighted averages.
 * Mirrors the Confusion matrix treatment: shared FilterBar, URL-synced
 * top-N + filters, "Other" folding for the long tail, and the diverging
 * F1 palette from AddaxAI WebUI.
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
import { f1DivergingColor, formatPercent } from '../../utils/performance-metrics';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

const OTHER_LABEL = 'other';
const DETECTOR_CATEGORIES = new Set(['empty', 'person', 'vehicle']);

const TOP_N_VALUES: { value: string; label: string }[] = [
  { value: '10', label: '10 classes' },
  { value: '20', label: '20 classes' },
  { value: '50', label: '50 classes' },
  { value: 'all', label: 'All classes' },
];

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  camera_ids: 'string[]',
  top_n: 'string',
};

const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';
const asStringArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : [];

interface ClassRow {
  className: string;
  displayName: string;
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  isDetectorCategory: boolean;
  isOther: boolean;
}

function f1FromPrecisionRecall(p: number | null, r: number | null): number | null {
  if (p === null || r === null) return null;
  if (p + r <= 0) return null;
  return (2 * p * r) / (p + r);
}

function metricsForClass(data: PerformanceData, idx: number): {
  support: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
} {
  const tp = data.matrix[idx][idx];
  const support = data.matrix_row_totals[idx];
  const colTotal = data.matrix_col_totals[idx];
  const precision = colTotal > 0 ? tp / colTotal : null;
  const recall = support > 0 ? tp / support : null;
  return { support, precision, recall, f1: f1FromPrecisionRecall(precision, recall) };
}

/**
 * Build the rows we'll render. Top-N keeps the biggest classes; the rest
 * fold into a single "Other" row whose precision / recall / F1 treat the
 * folded group as one virtual class. Detector categories (empty, person,
 * vehicle) are kept in the table but flagged so they can be styled muted
 * and dropped from averages.
 */
function buildRows(data: PerformanceData, topN: number | null): ClassRow[] {
  const order = data.matrix_classes
    .map((cls, idx) => {
      const m = metricsForClass(data, idx);
      return {
        idx,
        cls,
        support: m.support,
        colTotal: data.matrix_col_totals[idx],
        freq: m.support + data.matrix_col_totals[idx],
      };
    })
    .filter((row) => row.support > 0 || row.colTotal > 0)
    .sort((a, b) => {
      if (b.support !== a.support) return b.support - a.support;
      return a.cls.localeCompare(b.cls);
    });

  const keep = topN === null ? order : order.slice(0, topN);
  const fold = topN === null ? [] : order.slice(topN);

  const rows: ClassRow[] = keep.map(({ cls, idx }) => {
    const m = metricsForClass(data, idx);
    return {
      className: cls,
      displayName: normalizeLabel(cls),
      support: m.support,
      precision: m.precision,
      recall: m.recall,
      f1: m.f1,
      isDetectorCategory: DETECTOR_CATEGORIES.has(cls),
      isOther: false,
    };
  });

  if (fold.length > 0) {
    const foldedIndices = new Set(fold.map((r) => r.idx));
    let tpOther = 0;
    let fnOther = 0;
    let fpOther = 0;
    let supportOther = 0;
    for (const { idx: r } of fold) {
      supportOther += data.matrix_row_totals[r];
      for (let c = 0; c < data.matrix_classes.length; c++) {
        const val = data.matrix[r][c];
        if (foldedIndices.has(c)) {
          tpOther += val;
        } else {
          fnOther += val;
        }
      }
    }
    for (let r = 0; r < data.matrix_classes.length; r++) {
      if (foldedIndices.has(r)) continue;
      for (const { idx: c } of fold) {
        fpOther += data.matrix[r][c];
      }
    }
    const precisionOther =
      tpOther + fpOther > 0 ? tpOther / (tpOther + fpOther) : null;
    const recallOther =
      tpOther + fnOther > 0 ? tpOther / (tpOther + fnOther) : null;
    rows.push({
      className: OTHER_LABEL,
      displayName: 'Other',
      support: supportOther,
      precision: precisionOther,
      recall: recallOther,
      f1: f1FromPrecisionRecall(precisionOther, recallOther),
      isDetectorCategory: false,
      isOther: true,
    });
  }

  return rows;
}

function fmtMetric(v: number | null): string {
  return v === null ? '–' : formatPercent(v);
}

function averageOver(rows: ClassRow[], key: 'precision' | 'recall' | 'f1'): number | null {
  const eligible = rows.filter(
    (r) => !r.isDetectorCategory && !r.isOther && r[key] !== null,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((s, r) => s + (r[key] as number), 0) / eligible.length;
}

function weightedAverage(
  rows: ClassRow[],
  key: 'precision' | 'recall' | 'f1',
): number | null {
  const eligible = rows.filter(
    (r) => !r.isDetectorCategory && !r.isOther && r[key] !== null && r.support > 0,
  );
  const totalSupport = eligible.reduce((s, r) => s + r.support, 0);
  if (totalSupport === 0) return null;
  return (
    eligible.reduce((s, r) => s + (r[key] as number) * r.support, 0) /
    totalSupport
  );
}

const MetricsTable: React.FC<{
  rows: ClassRow[];
  projectId: number;
}> = ({ rows, projectId }) => {
  const navigate = useNavigate();

  const macroP = averageOver(rows, 'precision');
  const macroR = averageOver(rows, 'recall');
  const macroF1 = averageOver(rows, 'f1');
  const weightedP = weightedAverage(rows, 'precision');
  const weightedR = weightedAverage(rows, 'recall');
  const weightedF1 = weightedAverage(rows, 'f1');

  const handleRowClick = (row: ClassRow) => {
    if (row.isOther || row.isDetectorCategory) return;
    const params = new URLSearchParams();
    params.set('species', row.className);
    params.set('verified', 'true');
    navigate(`/projects/${projectId}/images?${params.toString()}`);
  };

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Not enough data yet.</p>;
  }

  return (
    <div className="block max-w-full max-h-[60vh] overflow-auto border border-input rounded-md">
      <table className="text-sm w-full">
        <thead className="sticky top-0 bg-background border-b">
          <tr>
            <th className="text-left py-2 pl-4 pr-6 font-medium">Class</th>
            <th className="text-right py-2 px-6 font-medium">Support</th>
            <th className="text-right py-2 px-6 font-medium">Precision</th>
            <th className="text-right py-2 px-6 font-medium">Recall</th>
            <th className="text-right py-2 pl-6 pr-4 font-medium">F1</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const muted = row.isDetectorCategory || row.isOther;
            const clickable = !muted;
            const rowTitle = row.isDetectorCategory
              ? 'Detector category, not a classifier class. Excluded from macro / weighted averages.'
              : row.isOther
                ? 'Bucket of classes outside the Show-top limit. Excluded from macro / weighted averages.'
                : undefined;
            return (
              <tr
                key={row.className}
                onClick={clickable ? () => handleRowClick(row) : undefined}
                title={rowTitle ?? `Click to open verified images of ${row.displayName}`}
                className={`border-b border-border/50 ${
                  clickable ? 'cursor-pointer hover:bg-muted/30' : ''
                } ${muted ? 'italic text-muted-foreground' : ''}`}
                style={row.isOther ? { borderStyle: 'dashed' } : undefined}
              >
                <td
                  className="py-1.5 pl-4 pr-6 overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{ maxWidth: '14rem' }}
                >
                  {row.displayName}
                </td>
                <td className="py-1.5 px-6 text-right tabular-nums">
                  {row.support.toLocaleString()}
                </td>
                <td className="py-1.5 px-6 text-right tabular-nums">{fmtMetric(row.precision)}</td>
                <td className="py-1.5 px-6 text-right tabular-nums">{fmtMetric(row.recall)}</td>
                <td
                  className="py-1.5 pl-6 pr-4 text-right tabular-nums"
                  style={f1DivergingColor(row.f1)}
                >
                  {fmtMetric(row.f1)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2">
          <SummaryRow label="Macro avg" p={macroP} r={macroR} f1={macroF1} />
          <SummaryRow label="Weighted avg" p={weightedP} r={weightedR} f1={weightedF1} />
        </tfoot>
      </table>
    </div>
  );
};

const SummaryRow: React.FC<{
  label: string;
  p: number | null;
  r: number | null;
  f1: number | null;
}> = ({ label, p, r, f1 }) => (
  <tr>
    <td className="py-1.5 pl-4 pr-6 font-medium whitespace-nowrap">{label}</td>
    <td />
    <td className="py-1.5 px-6 text-right tabular-nums font-medium">{fmtMetric(p)}</td>
    <td className="py-1.5 px-6 text-right tabular-nums font-medium">{fmtMetric(r)}</td>
    <td
      className="py-1.5 pl-6 pr-4 text-right tabular-nums font-medium"
      style={f1DivergingColor(f1)}
    >
      {fmtMetric(f1)}
    </td>
  </tr>
);

export const PerClassPerformancePage: React.FC = () => {
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
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), { replace: true });
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
    () => [{ key: 'top_n', label: 'Show top', options: TOP_N_VALUES }],
    [],
  );
  const displayValues: Record<string, string> = { top_n: topNValue };

  const rows = useMemo<ClassRow[] | null>(() => {
    if (!data) return null;
    return buildRows(data, topN);
  }, [data, topN]);

  const totalClasses = data?.matrix_classes.filter((cls, i) => {
    if (!data) return false;
    return data.matrix_row_totals[i] > 0 || data.matrix_col_totals[i] > 0;
  }).length ?? 0;
  const foldedCount = topN === null ? 0 : Math.max(0, totalClasses - topN);

  return (
    <InsightsPageLayout
      title="Performance"
      subtitle="Per-class precision, recall, and F1 from verified images"
    >
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
      ) : data.total_verified_images === 0 || rows === null || rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-sm">No verified images match the filters</p>
            <p className="text-muted-foreground text-xs mt-1">
              Verify some images on the Images page or widen the filters above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <PerformanceSummaryCards data={data} />
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <MetricsTable rows={rows} projectId={projectIdNum} />
            <div className="border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>
                Based on {data.total_verified_images.toLocaleString()} verified image
                {data.total_verified_images === 1 ? '' : 's'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {rows.filter((r) => !r.isOther).length} class
                {rows.filter((r) => !r.isOther).length === 1 ? '' : 'es'} shown
              </span>
              {foldedCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{foldedCount} folded into "other"</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Click a class to open the underlying images</span>
            </div>
          </div>
        </>
      )}

      <PlotExplainer
        plotKey="per-class-performance"
        what={
          <p>
            One row per class. Support counts the verified images where this class is the human
            top-1. Precision is the fraction of images predicted as this class that were actually
            this class. Recall is the fraction of images that actually were this class that the
            AI caught. F1 combines precision and recall into a single balanced score.
          </p>
        }
        how={
          <p>
            The F1 cell uses a diverging palette from red (low) through mid teal to dark teal
            (high) so strong and weak classes are easy to spot. Click any row to open the
            underlying verified images. Detector categories (<em>empty</em>, <em>person</em>,{' '}
            <em>vehicle</em>) and the <em>other</em> bucket render in italics and are excluded
            from the macro / weighted averages because they are not classifier predictions.
          </p>
        }
      />
    </InsightsPageLayout>
  );
};
