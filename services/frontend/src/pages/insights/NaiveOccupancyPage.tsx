/**
 * Insights -> Occupancy page.
 *
 * Naive occupancy bar chart with shared FilterBar, top-N truncation in
 * the Display popover, and a filter-scoped detection-history CSV button
 * in the page actions.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Download, Info } from 'lucide-react';

import { useProject } from '../../contexts/ProjectContext';
import { camerasApi } from '../../api/cameras';
import { statisticsApi } from '../../api/statistics';
import type { NaiveOccupancyMetadata } from '../../api/types';
import { Button } from '../../components/ui/Button';
import {
  FilterBar,
  type DisplayControlDef,
  type FilterFieldDef,
  type FilterValue,
} from '../../components/ui/FilterBar';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { type DateRange } from '../../components/dashboard';
import { NaiveOccupancyChart } from '../../components/dashboard/NaiveOccupancyChart';
import { PlotExplainer } from '../../components/plots/PlotExplainer';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

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
  camera_ids: 'string[]',
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
  const cameraIdValues = asStringArray(parsed.camera_ids);
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

  const { data: cameras } = useQuery({
    queryKey: ['cameras', projectId],
    queryFn: () => camerasApi.getAll(projectId),
    enabled: projectId !== undefined,
  });
  const { data: tagOptions } = useQuery({
    queryKey: ['camera-tags', projectId],
    queryFn: () => camerasApi.getTags(projectId),
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
    camera_ids: cameraIdValues.length > 0 ? cameraIdValues : undefined,
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
      camera_ids: undefined,
    });
  const onDisplayChange = (key: string, value: string) => writeAll({ [key]: value });

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

  // Effective camera_ids passed to the API: union of cameras directly
  // selected and cameras whose tags match.
  const cameraIdsFromTags = useMemo(() => {
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

  const [meta, setMeta] = useState<NaiveOccupancyMetadata | null>(null);
  const [downloading, setDownloading] = useState(false);

  // CSV uses the page's date filter when set. When the user has not
  // picked a window, fall back to the project's full lifetime (first
  // image to last image) so the default download covers all available
  // data. The chart's own window is untouched, so the CSV and the
  // chart can intentionally show different ranges.
  const handleDownload = async () => {
    if (!projectId || downloading) return;
    let from = dateRange.startDate || overview?.first_image_date;
    let to = dateRange.endDate || overview?.last_image_date;
    if (!from || !to) {
      // Fallback when the project has no images yet: 90-day window
      // ending today so the request still has valid bounds.
      const today = new Date();
      const past = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      from = iso(past);
      to = iso(today);
    }
    setDownloading(true);
    try {
      const { blob, filename } = await statisticsApi.downloadDetectionHistoryCsv(
        projectId,
        from,
        to,
        { cameraIds: cameraIdsFromTags, occasionLengthDays: 1 },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  const captionWindow =
    meta?.window_start && meta?.window_end ? `${meta.window_start} to ${meta.window_end}` : '';

  return (
    <InsightsPageLayout
      title="Naive occupancy"
      subtitle="Share of camera sites where each species was detected"
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={!projectId || downloading}
          onClick={handleDownload}
          className="gap-1"
          title={
            dateRange.startDate && dateRange.endDate
              ? 'Site-by-occasion CSV for unmarked or camtrapR'
              : 'Site-by-occasion CSV for unmarked or camtrapR. Defaults to the full project window; set a date range above to override.'
          }
        >
          <Download className="h-4 w-4" />
          {downloading ? 'Preparing...' : 'Export for R (CSV)'}
        </Button>
      }
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
          cameraIds={cameraIdsFromTags}
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
            <span aria-hidden="true">·</span>
            <span>Uncorrected for detection probability</span>
          </div>
        )}
      </div>
      <PlotExplainer
        plotKey="naive-occupancy"
        what={
          <p>
            For each species, the share of camera sites where it was detected at least once in
            the window. Bars are ranked from most-detected to least and labelled with the raw
            "detected at X of Y sites" count so small samples are easy to spot. A small darker
            tick on each bar marks the model-corrected occupancy that accounts for cameras
            missing the species when it was there.
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
              The tick on each bar is a single-season MacKenzie 2002 occupancy fit per species
              with constant detection probability and 7-day occasions. The tooltip reports the
              corrected value with a 95% Wald confidence interval. The corrected number is null
              when there are fewer than three sites, when all or no sites detected the species,
              or when the fit doesn't converge. For publication-grade estimates with covariates,
              export the CSV and run unmarked or camtrapR in R.
            </p>
          </>
        }
      />
    </InsightsPageLayout>
  );
};
