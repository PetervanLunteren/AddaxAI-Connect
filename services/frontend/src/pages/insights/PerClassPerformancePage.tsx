/**
 * Insights -> Per-class performance page.
 *
 * Per-class precision, recall, F1 from the confusion matrix, plus macro and
 * weighted averages. Click any row to open the underlying verified images
 * in the Images tab.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Info, Loader2, Target } from 'lucide-react';

import { performanceApi, type PerformanceData } from '../../api/performance';
import { Card, CardContent } from '../../components/ui/Card';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { PerformanceSummaryCards } from '../../components/performance/PerformanceSummaryCards';
import { PlotExplainer, type PlotReference } from '../../components/plots/PlotExplainer';
import { normalizeLabel } from '../../utils/labels';
import {
  computeDetailedMetrics,
  formatPercent,
  gradientStyle,
} from '../../utils/performance-metrics';

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

const MetricsTable: React.FC<{ data: PerformanceData; projectId: number }> = ({ data, projectId }) => {
  const navigate = useNavigate();
  const m = useMemo(() => computeDetailedMetrics(data), [data]);
  const [topN, setTopN] = useState<number | null>(20);

  const sortedPerClass = useMemo(() => {
    return [...m.perClass].sort((a, b) => {
      if (b.support !== a.support) return b.support - a.support;
      return a.species.localeCompare(b.species);
    });
  }, [m.perClass]);

  if (m.perClass.length === 0) {
    return <p className="text-sm text-muted-foreground">Not enough data yet.</p>;
  }

  const visiblePerClass = topN === null ? sortedPerClass : sortedPerClass.slice(0, topN);
  const fmt = (v: number | null) => (v === null ? 'n/a' : formatPercent(v));

  const handleRowClick = (cls: string) => {
    const params = new URLSearchParams();
    params.set('species', cls);
    params.set('verified', 'true');
    navigate(`/projects/${projectId}/images?${params.toString()}`);
  };

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
        <span className="text-muted-foreground">classes by support</span>
      </div>

      <div className="block max-w-full max-h-[60vh] overflow-auto border border-input rounded-md">
        <table className="text-sm">
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
            {visiblePerClass.map((c) => (
              <tr
                key={c.species}
                onClick={() => handleRowClick(c.species)}
                className="border-b border-border/50 cursor-pointer hover:bg-muted/30"
                title={`Click to open verified images of ${normalizeLabel(c.species)} in the Images tab`}
              >
                <td
                  className="py-1.5 pl-4 pr-6 overflow-hidden text-ellipsis whitespace-nowrap"
                  style={{ maxWidth: '12rem' }}
                >
                  {normalizeLabel(c.species)}
                </td>
                <td className="py-1.5 px-6 text-right tabular-nums">{c.support}</td>
                <td className="py-1.5 px-6 text-right tabular-nums">{fmt(c.precision)}</td>
                <td className="py-1.5 px-6 text-right tabular-nums">{fmt(c.recall)}</td>
                <td
                  className="py-1.5 pl-6 pr-4 text-right tabular-nums"
                  style={c.f1 !== null ? gradientStyle(c.f1) : undefined}
                >
                  {fmt(c.f1)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border">
            <tr>
              <td className="py-1.5 pl-4 pr-6 font-medium whitespace-nowrap">Macro avg</td>
              <td className="py-1.5 px-6" />
              <td className="py-1.5 px-6 text-right tabular-nums font-medium">{fmt(m.macroP)}</td>
              <td className="py-1.5 px-6 text-right tabular-nums font-medium">{fmt(m.macroR)}</td>
              <td
                className="py-1.5 pl-6 pr-4 text-right tabular-nums font-medium"
                style={m.macroF1 !== null ? gradientStyle(m.macroF1) : undefined}
              >
                {fmt(m.macroF1)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 pl-4 pr-6 font-medium whitespace-nowrap">Weighted avg</td>
              <td className="py-1.5 px-6" />
              <td className="py-1.5 px-6 text-right tabular-nums font-medium">{fmt(m.weightedP)}</td>
              <td className="py-1.5 px-6 text-right tabular-nums font-medium">{fmt(m.weightedR)}</td>
              <td
                className="py-1.5 pl-6 pr-4 text-right tabular-nums font-medium"
                style={m.weightedF1 !== null ? gradientStyle(m.weightedF1) : undefined}
              >
                {fmt(m.weightedF1)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export const PerClassPerformancePage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const projectIdNum = parseInt(projectId || '0', 10);

  const { data, isLoading, error } = useQuery({
    queryKey: ['performance', projectIdNum],
    queryFn: () => performanceApi.get(projectIdNum),
    enabled: !!projectIdNum,
  });

  return (
    <InsightsPageLayout
      title="Performance"
      subtitle="Per-class precision, recall, F1, plus macro and weighted averages"
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
            <MetricsTable data={data} projectId={projectIdNum} />
            <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>Based on {data.total_verified_images.toLocaleString()} verified image{data.total_verified_images === 1 ? '' : 's'}</span>
              <span aria-hidden="true">·</span>
              <span>{data.matrix_classes.length} class{data.matrix_classes.length === 1 ? '' : 'es'}</span>
              <span aria-hidden="true">·</span>
              <span>Click a row to open the underlying images</span>
            </div>
          </div>
        </>
      )}

      <PlotExplainer
        plotKey="per-class-performance"
        what={
          <p>
            Each row reports per-class metrics derived from the confusion matrix.
            Support is the number of verified images where this class is the human
            top-1. Precision is the fraction of images predicted as this class that
            were actually this class. Recall is the fraction of images that actually
            were this class that the AI caught. F1 combines precision and recall into
            a single balanced score using their harmonic mean.
          </p>
        }
        how={
          <p>
            The F1 cell is colour-scaled from light yellow (low) to dark teal (high) so strong
            and weak classes are easy to spot. Click any row to open the underlying verified
            images in the Images tab. The macro and weighted averages at the bottom are computed
            across <em>all</em> classes regardless of how many rows the top filter is showing.
          </p>
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};
