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
  const density = ((parsed.density as string) === 'compact' ? 'compact' : 'normal') as
    | 'normal'
    | 'compact';

  const dateRange: DateRange = { startDate, endDate };
  const selectedTags: Option[] = tagValues.map((v) => ({ label: v, value: v }));

  const writeFilters = (next: {
    startDate: string | null;
    endDate: string | null;
    tags: string[];
    density: 'normal' | 'compact';
  }) => {
    const params = filtersToSearchParams(
      {
        date_from: next.startDate ?? undefined,
        date_to: next.endDate ?? undefined,
        tags: next.tags,
        density: next.density === 'normal' ? undefined : next.density,
      },
      FILTER_SCHEMA,
    );
    setSearchParams(params, { replace: true });
  };

  const setDateRange = (range: DateRange) =>
    writeFilters({
      startDate: range.startDate,
      endDate: range.endDate,
      tags: tagValues,
      density,
    });
  const setTags = (tags: Option[]) =>
    writeFilters({
      startDate,
      endDate,
      tags: tags.map((t) => String(t.value)),
      density,
    });
  const setDensity = (d: 'normal' | 'compact') =>
    writeFilters({ startDate, endDate, tags: tagValues, density: d });

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

  const cameraIdsFromTags = useMemo(() => {
    if (tagValues.length === 0 || !cameras) return undefined;
    const tagSet = new Set(tagValues);
    const matchingIds = cameras
      .filter((c) => c.tags?.some((tag) => tagSet.has(tag)))
      .map((c) => c.id);
    return matchingIds.join(',') || '0';
  }, [tagValues, cameras]);

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
      <div className="flex items-center justify-end gap-2">
        <DashboardFilters
          tags={selectedTags}
          onTagsChange={setTags}
          tagOptions={tagOptions || []}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
        />
      </div>

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
            onZoom={(from, to) => writeFilters({ startDate: from, endDate: to, tags: tagValues, density })}
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
        caveats={
          <p>
            Image counts are attributed at the camera level, not split across overlapping
            deployments, so the &ldquo;images&rdquo; tooltip on the outer bar is shared across
            every deployment of that camera in the window. Splitting it per deployment would
            require an explicit camera-deployment join in the image table — a future enhancement.
          </p>
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
