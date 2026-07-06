/**
 * Insights -> Deployment timeline page.
 *
 * Connect-native rebuild: outer bars are configured deployment windows,
 * solid inner segments are days when the camera delivered at least one
 * image (gap-split when silent for three or more days). Heatmap mode
 * swaps the inner bar for a per-day intensity grid. Per-row status dot
 * matches the Cameras page rule (CameraHealthReport, seven-day cutoff).
 */
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';

import { useProject } from '../../contexts/ProjectContext';
import { sitesApi } from '../../api/sites';
import { statisticsApi } from '../../api/statistics';
import type { TimelineResponse, TimelineSite } from '../../api/types';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import {
  DeploymentTimelineChart,
  HEATMAP_BINS,
} from '../../components/plots/DeploymentTimelineChart';
import { PlotExplainer } from '../../components/plots/PlotExplainer';
import {
  FilterBar,
  type DisplayControlDef,
  type FilterFieldDef,
  type FilterValue,
} from '../../components/ui/FilterBar';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

type ViewMode = 'bars' | 'heatmap';
type SortBy = 'name' | 'last_image' | 'trap_nights';

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  site_ids: 'string[]',
  density: 'string',
  view_mode: 'string',
  sort_by: 'string',
};

export const DeploymentTimelinePage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

  const startDate = (parsed.date_from as string) || null;
  const endDate = (parsed.date_to as string) || null;
  const tagValues = Array.isArray(parsed.tags) ? parsed.tags : [];
  const siteIdValues = Array.isArray(parsed.site_ids) ? parsed.site_ids : [];
  const density = ((parsed.density as string) === 'compact' ? 'compact' : 'normal') as
    | 'normal'
    | 'compact';
  const viewMode: ViewMode = (parsed.view_mode as string) === 'heatmap' ? 'heatmap' : 'bars';
  const sortBy: SortBy = (() => {
    const v = parsed.sort_by as string;
    if (v === 'last_image' || v === 'trap_nights') return v;
    return 'name';
  })();

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

  const filterValues = useMemo<Record<string, FilterValue>>(
    () => ({
      date_from: startDate ?? undefined,
      date_to: endDate ?? undefined,
      tags: tagValues.length > 0 ? tagValues : undefined,
      site_ids: siteIdValues.length > 0 ? siteIdValues : undefined,
    }),
    [startDate, endDate, tagValues, siteIdValues],
  );

  const writeAll = (
    next: Record<string, FilterValue | undefined>,
  ) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      density: density === 'normal' ? undefined : density,
      view_mode: viewMode === 'bars' ? undefined : viewMode,
      sort_by: sortBy === 'name' ? undefined : sortBy,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), {
      replace: true,
    });
  };

  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () => {
    // Keep display controls; only wipe the four data filters.
    writeAll({
      date_from: undefined,
      date_to: undefined,
      tags: undefined,
      site_ids: undefined,
    });
  };
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
      },
    ],
    [sites, tagOptions],
  );

  const displayControls = useMemo<DisplayControlDef[]>(
    () => [
      {
        key: 'view_mode',
        label: 'View mode',
        options: [
          { value: 'bars', label: 'Bars' },
          { value: 'heatmap', label: 'Heatmap' },
        ],
      },
      {
        key: 'sort_by',
        label: 'Sort rows',
        options: [
          { value: 'name', label: 'Site name' },
          { value: 'last_image', label: 'Last image' },
          { value: 'trap_nights', label: 'Days with images' },
        ],
      },
      {
        key: 'density',
        label: 'Row density',
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'compact', label: 'Compact' },
        ],
      },
    ],
    [],
  );

  const displayValues: Record<string, string> = {
    view_mode: viewMode,
    sort_by: sortBy,
    density: density,
  };

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

  const { data, isLoading } = useQuery<TimelineResponse>({
    queryKey: ['statistics', 'timeline', projectId, startDate, endDate, siteIdsFromTags],
    queryFn: () =>
      statisticsApi.getTimeline(projectId!, {
        site_ids: siteIdsFromTags,
        start_date: startDate ?? undefined,
        end_date: endDate ?? undefined,
      }),
    enabled: projectId !== undefined,
  });

  const orderedData = useMemo<TimelineResponse | undefined>(() => {
    if (!data) return undefined;
    const trapNightsBySite = new Map<string, number>();
    for (const site of data.sites) {
      const total = site.intervals.reduce((s, iv) => s + iv.trap_nights, 0);
      trapNightsBySite.set(site.site_id ?? '', total);
    }

    const compare = (a: TimelineSite, b: TimelineSite): number => {
      if (sortBy === 'last_image') {
        const av = a.last_image_day ?? '';
        const bv = b.last_image_day ?? '';
        if (av === bv) return a.site_name.localeCompare(b.site_name);
        return bv.localeCompare(av);
      }
      if (sortBy === 'trap_nights') {
        const av = trapNightsBySite.get(a.site_id ?? '') ?? 0;
        const bv = trapNightsBySite.get(b.site_id ?? '') ?? 0;
        if (av === bv) return a.site_name.localeCompare(b.site_name);
        return bv - av;
      }
      return a.site_name.localeCompare(b.site_name);
    };

    const sorted = [...data.sites].sort(compare);
    return { ...data, sites: sorted };
  }, [data, sortBy]);

  const subtitle = 'Per-site activity over time, with a strip showing how many sites delivered images each day';

  return (
    <InsightsPageLayout title="Timeline" subtitle={subtitle}>
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
        displayControls={displayControls}
        displayValues={displayValues}
        onDisplayChange={onDisplayChange}
      />

      {!projectId || isLoading || !orderedData ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : orderedData.sites.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          No site activity matches the current filters.
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4 relative">
          {viewMode === 'heatmap' && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Images per day</span>
              {HEATMAP_BINS.map((bin) => (
                <span key={bin.min} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block w-4 h-3 rounded-sm border border-black/10"
                    style={{ backgroundColor: bin.fill }}
                    aria-hidden="true"
                  />
                  <span>{bin.label}</span>
                </span>
              ))}
            </div>
          )}
          <DeploymentTimelineChart
            data={orderedData}
            density={density}
            viewMode={viewMode}
            onZoom={(from, to) => writeAll({ date_from: from, date_to: to })}
          />
          <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>{orderedData.metrics.site_count} sites</span>
            <span aria-hidden="true">·</span>
            <span>{orderedData.metrics.total_trap_nights.toLocaleString()} days with images</span>
            <span aria-hidden="true">·</span>
            <span>busiest day {orderedData.metrics.max_concurrent_cameras} sites</span>
            <span aria-hidden="true">·</span>
            <span>Drag to zoom in</span>
          </div>
        </div>
      )}

      <PlotExplainer
        plotKey="deployment-timeline"
        what={
          <p>
            One row per site. A day shows fill when a camera at the site gave any sign of life that day,
            either an image or a daily health report. A day with neither shows as a gap. The
            strip below counts how many sites gave a sign of life on each day. Heatmap mode
            replaces the bars with one cell per day, coloured by how many images arrived that
            day.
          </p>
        }
        how={
          <p>
            A day is filled when a camera at the site sent at least one image or one daily check-in
            that day. A day with neither leaves a gap, so visible gaps mean the site went silent.
            The status dot follows the Cameras-page rule (green if a camera at the site checked in
            within the last week). Faint ticks mark the day a new deployment started.
            In heatmap mode, day cells switch to weekly cells once the visible range goes past
            a year.
          </p>
        }
      />
    </InsightsPageLayout>
  );
};
