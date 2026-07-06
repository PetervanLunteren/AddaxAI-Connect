/**
 * Insights -> Occupancy page.
 *
 * Naive occupancy bar chart with shared FilterBar and top-N truncation
 * in the Display popover. The detection-history CSV download lives on
 * the Exports page since it's a publication-grade export, not a chart
 * control.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';

import { useProject } from '../../contexts/ProjectContext';
import { sitesApi } from '../../api/sites';
import { statisticsApi } from '../../api/statistics';
import type { NaiveOccupancyMetadata } from '../../api/types';
import {
  FilterBar,
  type DisplayControlDef,
  type FilterFieldDef,
  type FilterValue,
} from '../../components/ui/FilterBar';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { type DateRange } from '../../components/dashboard';
import { NaiveOccupancyChart } from '../../components/dashboard/NaiveOccupancyChart';
import { PlotExplainer, type PlotReference } from '../../components/plots/PlotExplainer';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

const REFERENCES: PlotReference[] = [
  {
    citation:
      'MacKenzie, D. I., Nichols, J. D., Lachman, G. B., Droege, S., Royle, J. A., & ' +
      'Langtimm, C. A. (2002). Estimating site occupancy rates when detection ' +
      'probabilities are less than one. Ecology, 83(8), 2248-2255.',
    url: 'https://doi.org/10.1890/0012-9658(2002)083[2248:ESORWD]2.0.CO;2',
  },
];

const TOP_N_VALUES: { value: string; label: string }[] = [
  { value: '10', label: '10 species' },
  { value: '15', label: '15 species' },
  { value: '25', label: '25 species' },
  { value: '50', label: '50 species' },
  { value: 'all', label: 'All species' },
];

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  site_ids: 'string[]',
  top_n: 'string',
};

const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';
const asStringArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : [];

export const NaiveOccupancyPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

  const dateRange: DateRange = useMemo(
    () => ({
      startDate: asString(parsed.date_from) || null,
      endDate: asString(parsed.date_to) || null,
    }),
    [parsed.date_from, parsed.date_to],
  );
  const tagValues = asStringArray(parsed.tags);
  const siteIdValues = asStringArray(parsed.site_ids);
  const topNRaw = asString(parsed.top_n);
  const topN: number | null = (() => {
    if (topNRaw === 'all') return null;
    const n = Number(topNRaw);
    if (Number.isFinite(n) && n > 0) return n;
    return 15;
  })();
  const topNValue: string =
    topNRaw === '10' || topNRaw === '15' || topNRaw === '25' || topNRaw === '50' || topNRaw === 'all'
      ? topNRaw
      : '15';

  const { data: sites } = useQuery({
    queryKey: ['sites', projectId],
    queryFn: () => sitesApi.list(projectId!),
    enabled: projectId !== undefined,
  });
  const { data: tagOptions } = useQuery({
    queryKey: ['site-tags', projectId],
    queryFn: () => sitesApi.getTags(projectId!),
    enabled: projectId !== undefined,
  });
  const { data: overview } = useQuery({
    queryKey: ['statistics', 'overview', projectId],
    queryFn: () => statisticsApi.getOverview(projectId),
    enabled: projectId !== undefined,
  });

  const filterValues: Record<string, FilterValue> = {
    date_from: dateRange.startDate ?? undefined,
    date_to: dateRange.endDate ?? undefined,
    tags: tagValues.length > 0 ? tagValues : undefined,
    site_ids: siteIdValues.length > 0 ? siteIdValues : undefined,
  };

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      top_n: topNValue === '15' ? undefined : topNValue,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), { replace: true });
  };
  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () =>
    writeAll({
      date_from: undefined,
      date_to: undefined,
      tags: undefined,
      site_ids: undefined,
    });
  const onDisplayChange = (key: string, value: string) => writeAll({ [key]: value });

  const filterFields = useMemo<FilterFieldDef[]>(
    () => [
      {
        kind: 'multi-select',
        key: 'site_ids',
        label: 'Sites',
        options: (sites ?? []).map((s) => ({ label: s.name, value: String(s.id) })),
        placeholder: 'All sites',
        summary: (n) => `${n} sites`,
      },
      {
        kind: 'multi-select',
        key: 'tags',
        label: 'Site tags',
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
    [sites, tagOptions, overview],
  );

  const displayControls = useMemo<DisplayControlDef[]>(
    () => [{ key: 'top_n', label: 'Show top', options: TOP_N_VALUES }],
    [],
  );
  const displayValues: Record<string, string> = { top_n: topNValue };

  // Effective site_ids passed to the API: union of cameras directly
  // selected and cameras whose tags match.
  const siteIdsFromTags = useMemo(() => {
    if (tagValues.length === 0 && siteIdValues.length === 0) return undefined;
    const ids = new Set<string>(siteIdValues);
    if (tagValues.length > 0 && sites) {
      const tagSet = new Set(tagValues);
      for (const s of sites) {
        if (s.tags?.some((tag) => tagSet.has(tag))) ids.add(String(s.id));
      }
    }
    return ids.size === 0 ? '0' : Array.from(ids).join(',');
  }, [tagValues, siteIdValues, sites]);

  const [meta, setMeta] = useState<NaiveOccupancyMetadata | null>(null);

  const captionWindow =
    meta?.window_start && meta?.window_end ? `${meta.window_start} to ${meta.window_end}` : '';

  return (
    <InsightsPageLayout
      title="Naive occupancy"
      subtitle="Share of camera sites where each species was detected"
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
      <div className="rounded-lg border bg-card p-4">
        <NaiveOccupancyChart
          dateRange={dateRange}
          projectId={projectId}
          siteIds={siteIdsFromTags}
          topN={topN}
          onMetadataChange={setMeta}
        />
        {meta && (
          <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>{meta.sites_total} active sites</span>
            {captionWindow && (
              <>
                <span aria-hidden="true">·</span>
                <span>Window {captionWindow}</span>
              </>
            )}
          </div>
        )}
      </div>
      <PlotExplainer
        plotKey="naive-occupancy"
        what={
          <p>
            For each species, the share of camera sites where it was detected at least once in
            the window. Bars are ranked from most-detected to least and labelled with the raw
            "detected at X of Y sites" count so small samples are easy to spot. A darker diamond
            with a horizontal whisker marks the model-corrected occupancy and its 95%
            confidence range when the data supports a stable fit.
          </p>
        }
        how={
          <>
            <p>
              A camera counts as an active site if any of its deployment periods overlaps the
              window, even by a single day. Person and vehicle detections are excluded. Verified
              images override the AI label for the same image. "Naive" means the bar shows raw
              presence and does not correct for the chance that a species was there but missed.
            </p>
            <p>
              The diamond is a single-season MacKenzie 2002 occupancy fit per species with
              constant detection probability and 7-day occasions. The whisker is the 95% Wald
              confidence interval on the corrected value. Nothing is drawn when fewer than three
              sites are active, when every or no site detected the species, or when the model
              cannot pin down a confidence interval. For publication-grade estimates with
              covariates, download the detection-history CSV from the Exports page and run{' '}
              <code className="bg-muted px-1 py-0.5 rounded">unmarked</code> or{' '}
              <code className="bg-muted px-1 py-0.5 rounded">camtrapR</code> in R.
            </p>
          </>
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};
