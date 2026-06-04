/**
 * Detection-rate map panel.
 *
 * The detection-rate heatmap plus its own filter/display controls, self-
 * contained so it can be dropped into the project Map page as the "Detections"
 * layer. URL-synced like the other map layers. Lifted out of the old
 * Insights -> Map page, which has been retired in favor of the unified Map.
 */
import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { DetectionRateMap, type ViewMode } from './index';
import { PlotExplainer } from '../plots/PlotExplainer';
import {
  FilterBar,
  type DisplayControlDef,
  type FilterFieldDef,
  type FilterValue,
} from '../ui/FilterBar';
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  type FilterSchema,
} from '../../lib/filter-url';
import { useProject } from '../../contexts/ProjectContext';
import { camerasApi } from '../../api/cameras';
import { imagesApi } from '../../api/images';
import { statisticsApi } from '../../api/statistics';
import type { DetectionRateMapFilters } from '../../api/types';

const FILTER_SCHEMA: FilterSchema = {
  date_from: 'date',
  date_to: 'date',
  tags: 'string[]',
  camera_ids: 'string[]',
  species: 'string',
  view_mode: 'string',
};

const asString = (v: string | string[] | undefined): string =>
  typeof v === 'string' ? v : '';
const asStringArray = (v: string | string[] | undefined): string[] =>
  Array.isArray(v) ? v : [];

export const DetectionRatePanel: React.FC = () => {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = filtersFromSearchParams(searchParams, FILTER_SCHEMA);

  const cameraIdValues = asStringArray(parsed.camera_ids);
  const tagValues = asStringArray(parsed.tags);
  const startDate = asString(parsed.date_from);
  const endDate = asString(parsed.date_to);
  const species = asString(parsed.species);
  const viewMode = (parsed.view_mode === 'points' || parsed.view_mode === 'clusters'
    ? parsed.view_mode
    : 'hexbins') as ViewMode;

  const filterValues: Record<string, FilterValue> = {
    camera_ids: cameraIdValues.length > 0 ? cameraIdValues : undefined,
    tags: tagValues.length > 0 ? tagValues : undefined,
    species: species || undefined,
    date_from: startDate || undefined,
    date_to: endDate || undefined,
  };

  const writeAll = (next: Record<string, FilterValue | undefined>) => {
    const merged: Record<string, FilterValue | undefined> = {
      ...filterValues,
      view_mode: viewMode === 'hexbins' ? undefined : viewMode,
      ...next,
    };
    setSearchParams(filtersToSearchParams(merged, FILTER_SCHEMA), { replace: true });
  };
  const onFilterChange = (patch: Record<string, FilterValue>) => writeAll(patch);
  const onClearAll = () =>
    writeAll({
      camera_ids: undefined,
      tags: undefined,
      species: undefined,
      date_from: undefined,
      date_to: undefined,
    });
  const onDisplayChange = (key: string, value: string) => writeAll({ [key]: value });

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

  // camera_ids passed to the map API: the union of explicitly-picked cameras
  // and cameras matching the selected tags.
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

  const mapFilters: DetectionRateMapFilters = useMemo(
    () => ({
      species: species || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      camera_ids: cameraIdsParam,
    }),
    [species, startDate, endDate, cameraIdsParam],
  );

  const filterFields: FilterFieldDef[] = useMemo(
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
        kind: 'select',
        key: 'species',
        label: 'Species',
        options: (speciesOptions ?? []).map((s) => ({
          value: String(s.value),
          label: String(s.label),
        })),
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
    [cameras, tagOptions, speciesOptions, overview],
  );

  const displayControls: DisplayControlDef[] = [
    {
      key: 'view_mode',
      label: 'View mode',
      options: [
        { value: 'hexbins', label: 'Hexbins' },
        { value: 'points', label: 'Points' },
        { value: 'clusters', label: 'Clusters' },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {/* Leaflet's panes stack up to z-index 700 within its own context.
          Lift the FilterBar above so the MultiSelect dropdown and the
          More/Display popovers render on top of the map below. */}
      <div className="relative z-[1100]">
        <FilterBar
          fields={filterFields}
          values={filterValues}
          onChange={onFilterChange}
          onClearAll={onClearAll}
          displayControls={displayControls}
          displayValues={{ view_mode: viewMode }}
          onDisplayChange={onDisplayChange}
        />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <DetectionRateMap filters={mapFilters} viewMode={viewMode} />
      </div>
      <PlotExplainer
        plotKey="detection-rate-map"
        what={
          <p>
            One coloured cell per camera deployment, mapped to the deployment&apos;s
            recorded GPS. Three view modes choose how the cells are drawn: hexbins
            aggregate nearby deployments onto a hex grid, points show each deployment
            individually, and clusters group nearby points into a single circle with
            the count inside. The species and camera-tag filters narrow which
            detections and which sites enter the calculation.
          </p>
        }
        how={
          <p>
            Detection rate = detections in the window divided by the days the camera
            was deployed. Active deployments count up to today. Detections below the
            project&apos;s confidence threshold are dropped, and a human-verified
            image always wins over the AI. Colours rescale to fit the cells currently
            in view, not a fixed scale across projects.
          </p>
        }
      />
    </div>
  );
};
