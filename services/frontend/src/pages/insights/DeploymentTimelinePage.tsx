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
import { camerasApi } from '../../api/cameras';
import { statisticsApi } from '../../api/statistics';
import type { TimelineResponse, TimelineSite } from '../../api/types';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { DeploymentTimelineChart } from '../../components/plots/DeploymentTimelineChart';
import { PlotExplainer, type PlotReference } from '../../components/plots/PlotExplainer';
import {
  DashboardFilters,
  type DateRange,
} from '../../components/dashboard';
import type { Option } from '../../components/ui/MultiSelect';
import { Select, SelectItem } from '../../components/ui/Select';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';

type ViewMode = 'deployment' | 'heatmap';
type SortBy = 'name' | 'last_image' | 'trap_nights';
type GroupBy = 'none' | 'tag';

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  camera_ids: 'string[]',
  density: 'string',
  view_mode: 'string',
  sort_by: 'string',
  group_by: 'string',
};

const REFERENCES: PlotReference[] = [
  {
    citation:
      'Meek, P. D., Ballard, G., Claridge, A., et al. (2014). Recommended guiding principles for ' +
      'reporting on camera trapping research. Biodiversity and Conservation, 23(9), 2321–2343.',
    url: 'https://link.springer.com/article/10.1007/s10531-014-0712-8',
  },
];

const NO_TAG_LABEL = 'Untagged';

export const DeploymentTimelinePage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

  const startDate = (parsed.date_from as string) || null;
  const endDate = (parsed.date_to as string) || null;
  const tagValues = Array.isArray(parsed.tags) ? parsed.tags : [];
  const cameraIdValues = Array.isArray(parsed.camera_ids) ? parsed.camera_ids : [];
  const density = ((parsed.density as string) === 'compact' ? 'compact' : 'normal') as
    | 'normal'
    | 'compact';
  const viewMode: ViewMode = (parsed.view_mode as string) === 'heatmap' ? 'heatmap' : 'deployment';
  const sortBy: SortBy = (() => {
    const v = parsed.sort_by as string;
    if (v === 'last_image' || v === 'trap_nights') return v;
    return 'name';
  })();
  const groupBy: GroupBy = (parsed.group_by as string) === 'tag' ? 'tag' : 'none';

  const dateRange: DateRange = { startDate, endDate };
  const selectedTags: Option[] = tagValues.map((v) => ({ label: v, value: v }));

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
  const selectedCameras: Option[] = useMemo(() => {
    if (!cameras) return cameraIdValues.map((id) => ({ label: id, value: id }));
    const byId = new Map(cameras.map((c) => [String(c.id), c.name]));
    return cameraIdValues.map((id) => ({ label: byId.get(id) ?? id, value: id }));
  }, [cameraIdValues, cameras]);

  const writeFilters = (next: {
    startDate?: string | null;
    endDate?: string | null;
    tags?: string[];
    cameraIds?: string[];
    density?: 'normal' | 'compact';
    viewMode?: ViewMode;
    sortBy?: SortBy;
    groupBy?: GroupBy;
  }) => {
    const nextStart = next.startDate !== undefined ? next.startDate : startDate;
    const nextEnd = next.endDate !== undefined ? next.endDate : endDate;
    const nextTags = next.tags ?? tagValues;
    const nextCams = next.cameraIds ?? cameraIdValues;
    const nextDensity = next.density ?? density;
    const nextView = next.viewMode ?? viewMode;
    const nextSort = next.sortBy ?? sortBy;
    const nextGroup = next.groupBy ?? groupBy;
    const params = filtersToSearchParams(
      {
        date_from: nextStart ?? undefined,
        date_to: nextEnd ?? undefined,
        tags: nextTags,
        camera_ids: nextCams,
        density: nextDensity === 'normal' ? undefined : nextDensity,
        view_mode: nextView === 'deployment' ? undefined : nextView,
        sort_by: nextSort === 'name' ? undefined : nextSort,
        group_by: nextGroup === 'none' ? undefined : nextGroup,
      },
      FILTER_SCHEMA,
    );
    setSearchParams(params, { replace: true });
  };

  const setDateRange = (range: DateRange) =>
    writeFilters({ startDate: range.startDate, endDate: range.endDate });
  const setTags = (tags: Option[]) =>
    writeFilters({ tags: tags.map((t) => String(t.value)) });
  const setCameras = (cams: Option[]) =>
    writeFilters({ cameraIds: cams.map((c) => String(c.value)) });
  const setDensity = (d: 'normal' | 'compact') => writeFilters({ density: d });
  const setViewMode = (m: ViewMode) => writeFilters({ viewMode: m });
  const setSortBy = (s: SortBy) => writeFilters({ sortBy: s });
  const setGroupBy = (g: GroupBy) => writeFilters({ groupBy: g });

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

  const { data, isLoading } = useQuery<TimelineResponse>({
    queryKey: ['statistics', 'timeline', projectId, startDate, endDate, cameraIdsFromTags],
    queryFn: () =>
      statisticsApi.getTimeline(projectId!, {
        camera_ids: cameraIdsFromTags,
        start_date: startDate ?? undefined,
        end_date: endDate ?? undefined,
      }),
    enabled: projectId !== undefined,
  });

  // Site-level tag lookup, needed for sort-by-tag and group-by-tag. Picks
  // the first tag alphabetically so behaviour stays stable across page
  // reloads even when a camera carries several tags.
  const primaryTagBySiteId = useMemo(() => {
    const out = new Map<string, string>();
    if (!cameras) return out;
    for (const c of cameras) {
      const tags = (c.tags ?? []).slice().sort();
      out.set(String(c.id), tags[0] ?? NO_TAG_LABEL);
    }
    return out;
  }, [cameras]);

  const orderedData = useMemo<TimelineResponse | undefined>(() => {
    if (!data) return undefined;
    const trapNightsBySite = new Map<string, number>();
    for (const site of data.sites) {
      const total = site.deployments.reduce(
        (acc, dep) => acc + dep.intervals.reduce((s, iv) => s + iv.trap_nights, 0),
        0,
      );
      trapNightsBySite.set(site.site_id ?? '', total);
    }

    const compareWithinGroup = (a: TimelineSite, b: TimelineSite): number => {
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

    const sorted = [...data.sites].sort((a, b) => {
      if (groupBy === 'tag') {
        const at = primaryTagBySiteId.get(a.site_id ?? '') ?? NO_TAG_LABEL;
        const bt = primaryTagBySiteId.get(b.site_id ?? '') ?? NO_TAG_LABEL;
        if (at !== bt) return at.localeCompare(bt);
      }
      return compareWithinGroup(a, b);
    });
    return { ...data, sites: sorted };
  }, [data, sortBy, groupBy, primaryTagBySiteId]);

  const groupKeyForSite = useMemo(() => {
    if (groupBy !== 'tag') return undefined;
    return (siteId: string | null) => {
      if (siteId === null) return NO_TAG_LABEL;
      return primaryTagBySiteId.get(siteId) ?? NO_TAG_LABEL;
    };
  }, [groupBy, primaryTagBySiteId]);

  const subtitle = 'Per-camera activity over time, with a strip showing how many cameras delivered images each day';

  return (
    <InsightsPageLayout
      title="Deployment timeline"
      subtitle={subtitle}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={viewMode}
            onValueChange={(v) => setViewMode(v === 'heatmap' ? 'heatmap' : 'deployment')}
            className="h-9 text-sm w-36"
            aria-label="View mode"
          >
            <SelectItem value="deployment">Deployment</SelectItem>
            <SelectItem value="heatmap">Heatmap</SelectItem>
          </Select>
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortBy)}
            className="h-9 text-sm w-44"
            aria-label="Sort rows"
          >
            <SelectItem value="name">Sort by name</SelectItem>
            <SelectItem value="last_image">Sort by last image</SelectItem>
            <SelectItem value="trap_nights">Sort by trap-nights</SelectItem>
          </Select>
          <Select
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as GroupBy)}
            className="h-9 text-sm w-36"
            aria-label="Group rows"
          >
            <SelectItem value="none">No grouping</SelectItem>
            <SelectItem value="tag">Group by tag</SelectItem>
          </Select>
          <Select
            value={density}
            onValueChange={(v) => setDensity(v === 'compact' ? 'compact' : 'normal')}
            className="h-9 text-sm w-32"
            aria-label="Row density"
          >
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="compact">Compact</SelectItem>
          </Select>
        </div>
      }
    >
      <DashboardFilters
        cameras={selectedCameras}
        onCamerasChange={setCameras}
        cameraOptions={cameras ?? []}
        tags={selectedTags}
        onTagsChange={setTags}
        tagOptions={tagOptions || []}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      {!projectId || isLoading || !orderedData ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : orderedData.sites.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          No deployments match the current filters.
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4 relative">
          <DeploymentTimelineChart
            data={orderedData}
            density={density}
            viewMode={viewMode}
            onZoom={(from, to) => writeFilters({ startDate: from, endDate: to })}
            groupKeyForSite={groupKeyForSite}
          />
          <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>{orderedData.metrics.site_count} cameras</span>
            <span aria-hidden="true">·</span>
            <span>{orderedData.metrics.total_trap_nights.toLocaleString()} days with images</span>
            <span aria-hidden="true">·</span>
            <span>busiest day {orderedData.metrics.max_concurrent_cameras} cameras</span>
            <span aria-hidden="true">·</span>
            <span>Drag to zoom in</span>
          </div>
        </div>
      )}

      <PlotExplainer
        plotKey="deployment-timeline"
        what={
          <p>
            One row per camera. A solid green bar marks a stretch of days the camera delivered
            images. Empty space inside a row means the camera was silent for three or more days
            in a row. The strip below counts how many cameras delivered images on each day.
            Heatmap mode replaces the bars with one cell per day, coloured by how many images
            arrived that day.
          </p>
        }
        how={
          <>
            <p>
              Image dates come from <code>captured_at</code> in each image, read under the
              server timezone. A silence of one or two days is treated as part of the same
              stretch. A silence of three or more days starts a new stretch, drawn with a gap.
              Days with images counts the inclusive length of every stretch and sums them.
            </p>
            <p>
              The status dot on the left uses the same rule as the Cameras page, based on the
              most recent daily health report with a seven-day cutoff. A camera can show a green
              dot and still have a short bar, meaning the camera is reachable but is not sending
              many images right now.
            </p>
            <p>
              A faint vertical tick on a row marks the day the camera was moved more than 100 m
              to a new location. The bar does not break at a move because the camera kept
              delivering images on both sides of it.
            </p>
            <p>
              Heatmap mode auto-switches to weekly cells once the visible range goes past a
              year, so the cells stay readable on long timelines.
            </p>
          </>
        }
        settings={
          orderedData
            ? [
                {
                  label: 'Window',
                  detail: `${orderedData.date_range_from ?? '–'} to ${orderedData.date_range_to ?? '–'} (clipped to the date filter when set).`,
                },
                {
                  label: 'Cameras shown',
                  detail: `${orderedData.metrics.site_count} (set by the camera and tag filters).`,
                },
                {
                  label: 'View',
                  detail: `${viewMode === 'heatmap' ? 'Heatmap' : 'Deployment'} mode, sorted by ${sortLabel(sortBy)}${groupBy === 'tag' ? ', grouped by camera tag' : ''}.`,
                },
              ]
            : undefined
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};

function sortLabel(s: SortBy): string {
  if (s === 'last_image') return 'last image';
  if (s === 'trap_nights') return 'trap-nights';
  return 'camera name';
}
