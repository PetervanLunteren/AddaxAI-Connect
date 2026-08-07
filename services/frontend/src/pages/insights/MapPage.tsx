/**
 * Insights -> Map page (detection-rate map).
 *
 * Owns the filter and display state for the map. The map itself is
 * presentational; this page wires the shared FilterBar, syncs everything
 * through the URL, and passes plain props down. The metric select sits in
 * the primary bar; site tags and view mode live in the More popover.
 * Clear all resets everything, including metric and view mode.
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { DetectionRateMap, type ViewMode } from '../../components/map';
import { InsightsPageLayout } from '../../components/layout/InsightsPageLayout';
import { PlotExplainer } from '../../components/plots/PlotExplainer';
import {
  FilterBar,
  type FilterFieldDef,
  type FilterValue,
} from '../../components/ui/FilterBar';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';
import { useProject } from '../../contexts/ProjectContext';
import { sitesApi } from '../../api/sites';
import { imagesApi } from '../../api/images';
import { statisticsApi } from '../../api/statistics';
import {
  DEFAULT_MAP_METRIC,
  MAP_METRICS,
  type MapMetricId,
} from '../../utils/map-metrics';
import type { DetectionRateMapFilters } from '../../api/types';

const FILTER_SCHEMA: FilterSchema = {
  metric: 'string',
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  site_ids: 'string[]',
  species: 'string[]',
  view_mode: 'string',
};

const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';
const asStringArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : [];

const SUBTITLES: Record<MapMetricId, string> = {
  abundance: 'Detection rate per site, corrected for trap-days',
  richness: 'Species observed per site',
  effort: 'Trap-days of effort per site',
  shannon: 'Shannon diversity per site',
};

export const InsightsMapPage: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

  const siteIdValues = asStringArray(parsed.site_ids);
  const tagValues = asStringArray(parsed.tags);
  const startDate = asString(parsed.date_from);
  const endDate = asString(parsed.date_to);
  const speciesValues = asStringArray(parsed.species);
  const viewMode = (parsed.view_mode === 'hexbins' || parsed.view_mode === 'clusters'
    ? parsed.view_mode
    : 'points') as ViewMode;
  const rawMetric = asString(parsed.metric);
  const metricId: MapMetricId = Object.hasOwn(MAP_METRICS, rawMetric)
    ? (rawMetric as MapMetricId)
    : DEFAULT_MAP_METRIC;

  // Metric and view mode are FilterBar fields whose empty value is the
  // default, so the default stays out of the URL and off the chip row.
  const filterValues: Record<string, FilterValue> = {
    metric: metricId === DEFAULT_MAP_METRIC ? undefined : metricId,
    site_ids: siteIdValues.length > 0 ? siteIdValues : undefined,
    tags: tagValues.length > 0 ? tagValues : undefined,
    species: speciesValues.length > 0 ? speciesValues : undefined,
    date_from: startDate || undefined,
    date_to: endDate || undefined,
    view_mode: viewMode === 'points' ? undefined : viewMode,
  };

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), { replace: true });
  };
  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () => setSearchParams(new URLSearchParams(), { replace: true });

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
  const { data: speciesOptions } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });
  const { data: overview } = useQuery({
    queryKey: ['statistics', 'overview', projectId],
    queryFn: () => statisticsApi.getOverview(projectId),
    enabled: projectId !== undefined,
  });

  // Compute the site_ids string passed to the map API, mirroring the
  // union-of-cameras-and-tag-matches pattern used elsewhere.
  const siteIdsParam = useMemo(() => {
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

  const mapFilters: DetectionRateMapFilters = useMemo(
    () => ({
      // Comma-separated; several species combine their counts on the map
      species: speciesValues.length > 0 ? speciesValues.join(',') : undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      site_ids: siteIdsParam,
    }),
    [speciesValues, startDate, endDate, siteIdsParam],
  );

  const filterFields: FilterFieldDef[] = useMemo(
    () => [
      {
        kind: 'select',
        key: 'metric',
        label: 'Metric',
        // The placeholder is the default metric, so the empty value means
        // abundance and clearing the chip returns to it
        placeholder: MAP_METRICS.abundance.label,
        options: (['richness', 'effort', 'shannon'] as const).map((id) => ({
          value: id,
          label: MAP_METRICS[id].label,
        })),
      },
      {
        kind: 'multi-select',
        key: 'species',
        label: 'Species',
        // Person and vehicle stay, their distribution is useful on a map.
        // Empty is an image-level pseudo-label (no detections), so it can
        // never produce a count here and is dropped from the options.
        options: (speciesOptions ?? [])
          .filter((s) => String(s.value) !== 'empty')
          .map((s) => ({
            value: String(s.value),
            label: String(s.label),
          })),
        placeholder: 'All species',
        summary: (n) => `${n} species`,
      },
      {
        kind: 'date-range',
        fromKey: 'date_from',
        toKey: 'date_to',
        label: 'Date range',
        minDate: overview?.first_image_date,
        maxDate: overview?.last_image_date,
      },
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
        primary: false,
        options: (tagOptions ?? []).map((t) => ({ label: t, value: t })),
        placeholder: 'Any tags',
        summary: (n) => `${n} tags`,
      },
      {
        kind: 'select',
        key: 'view_mode',
        label: 'View mode',
        primary: false,
        placeholder: 'Points',
        options: [
          { value: 'hexbins', label: 'Hexbins' },
          { value: 'clusters', label: 'Clusters' },
        ],
      },
    ],
    [sites, tagOptions, speciesOptions, overview],
  );

  return (
    <InsightsPageLayout title="Map" subtitle={SUBTITLES[metricId]}>
      <div>
        <FilterBar
          fields={filterFields}
          values={filterValues}
          onChange={onFilterChange}
          onClearAll={onClearAll}
        />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <DetectionRateMap
          filters={mapFilters}
          viewMode={viewMode}
          metric={metricId}
        />
      </div>
      <PlotExplainer
        plotKey="detection-rate-map"
        what={
          <p>
            One coloured cell per site, at the site location. A site pools all of
            its deployments, so a place with several deployments (relocations, or
            more than one camera) is a single point, not a stack. The metric
            selects what the colour means. Abundance is the detection rate per
            100 trap-days. Species richness is how many wildlife species were
            observed, and when species are selected it counts within that
            selection only. Trap effort is the number of trap-days. Shannon
            diversity summarises how many species there are and how evenly the
            detections spread over them. Three view modes choose how the cells
            are drawn: points show each site individually, hexbins aggregate
            nearby sites onto a hex grid, and clusters group nearby sites into
            a single circle showing the pooled value. Deployments with no site
            are not shown.
          </p>
        }
        how={
          <p>
            Abundance is the detections in the window divided by the trap-days,
            summed across the site&apos;s deployments, so more cameras or longer
            coverage adds effort and the rate stays comparable. Richness and
            Shannon diversity count wildlife species only, never people or
            vehicles, and are observed values without any correction. A site
            that runs longer tends to record more species, so judge richness
            with the trap-days shown next to it. Hexbins and clusters pool
            their sites before computing the value, so richness is the number
            of distinct species across the whole cell. Active deployments count
            up to today. Detections below the project&apos;s confidence
            threshold are dropped, and a human-verified image always wins over
            the AI. Colours rescale to fit the cells currently in view, not a
            fixed scale across projects.
          </p>
        }
      />
    </InsightsPageLayout>
  );
};
