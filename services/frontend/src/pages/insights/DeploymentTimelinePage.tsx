/**
 * Insights -> Deployment timeline page.
 *
 * Row-per-camera Gantt with trap-night intervals plus a concurrent-cameras
 * area chart underneath, mirroring AddaxAI WebUI. Filters live in the URL
 * via the Phase 1 filter-url helpers.
 */
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Info } from 'lucide-react';

import { useProject } from '../../contexts/ProjectContext';
import { camerasApi } from '../../api/cameras';
import { statisticsApi } from '../../api/statistics';
import type { TimelineResponse } from '../../api/types';
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

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  camera_ids: 'string[]',
  density: 'string',
};

const REFERENCES: PlotReference[] = [
  {
    citation:
      'Meek, P. D., Ballard, G., Claridge, A., et al. (2014). Recommended guiding principles for ' +
      'reporting on camera trapping research. Biodiversity and Conservation, 23(9), 2321–2343.',
    url: 'https://link.springer.com/article/10.1007/s10531-014-0712-8',
  },
];

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
  }) => {
    const nextStart = next.startDate !== undefined ? next.startDate : startDate;
    const nextEnd = next.endDate !== undefined ? next.endDate : endDate;
    const nextTags = next.tags ?? tagValues;
    const nextCams = next.cameraIds ?? cameraIdValues;
    const nextDensity = next.density ?? density;
    const params = filtersToSearchParams(
      {
        date_from: nextStart ?? undefined,
        date_to: nextEnd ?? undefined,
        tags: nextTags,
        camera_ids: nextCams,
        density: nextDensity === 'normal' ? undefined : nextDensity,
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

  // Effective camera_ids = union of cameras directly selected and cameras
  // whose tags match. Empty filter => undefined; both active but no match => '0'.
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

  const subtitle = 'Camera deployment periods over time, with a concurrent-cameras strip';

  return (
    <InsightsPageLayout
      title="Deployment timeline"
      subtitle={subtitle}
      actions={
        <Select
          value={density}
          onValueChange={(v) => setDensity(v === 'compact' ? 'compact' : 'normal')}
          className="h-9 text-sm w-32"
        >
          <SelectItem value="normal">Normal</SelectItem>
          <SelectItem value="compact">Compact</SelectItem>
        </Select>
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

      {!projectId || isLoading || !data ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : data.sites.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          No deployments match the current filters.
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4 relative">
          <DeploymentTimelineChart
            data={data}
            density={density}
            onZoom={(from, to) => writeFilters({ startDate: from, endDate: to })}
          />
          <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>{data.metrics.deployment_count} deployments across {data.metrics.site_count} cameras</span>
            <span aria-hidden="true">·</span>
            <span>{data.metrics.total_trap_nights.toLocaleString()} trap-nights total</span>
            <span aria-hidden="true">·</span>
            <span>peak {data.metrics.max_concurrent_cameras} concurrent</span>
            <span aria-hidden="true">·</span>
            <span>Drag horizontally to zoom</span>
          </div>
        </div>
      )}

      <PlotExplainer
        plotKey="deployment-timeline"
        what={
          <p>
            One row per camera. Each light bar is the configured deployment window for a camera at
            a single location; the solid bar inside is the trap-night interval that fell within
            the chosen date window. The strip at the bottom is the count of cameras simultaneously
            active each day, as a step function.
          </p>
        }
        how={
          <>
            <p>
              Connect models a camera moving more than 100 m as a new <code>CameraDeploymentPeriod</code>,
              so the bars on one row correspond to consecutive physical placements of that camera.
              An open (`end_date IS NULL`) deployment is clipped at the server&apos;s current date.
            </p>
            <p>
              Trap-nights = (end − start) + 1 days for each clipped interval. The concurrent
              cameras series is a sweep-line over all intervals; ties on a single day collapse to
              one point so the area chart stays clean.
            </p>
          </>
        }
        settings={
          data
            ? [
                {
                  label: 'Window',
                  detail: `${data.date_range_from ?? '–'} to ${data.date_range_to ?? '–'} (clipped to the date filter when set).`,
                },
                {
                  label: 'Cameras shown',
                  detail: `${data.metrics.site_count} (set by the camera-tag filter).`,
                },
              ]
            : undefined
        }
        references={REFERENCES}
      />
    </InsightsPageLayout>
  );
};
