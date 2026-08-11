/**
 * Dashboard Explore tab: pick one species and study it.
 *
 * Leads with photographs. Once a species has been named, a wall of its
 * clearest pictures is the fastest way to check whether the model is right,
 * and each one opens the modal that can correct the label. Looking turns into
 * verifying, which is the slow part of the product.
 *
 * Holds every card whose endpoint accepts a species, so one filter drives all
 * of them. An empty species means all species, same as before.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilterBar } from '../../components/ui/FilterBar';
import { ActivityPatternChart, DetectionTrendChart } from '../../components/dashboard';
import { DemographicsCard } from '../../components/dashboard/DemographicsCard';
import { BestPhotosCard } from '../../components/dashboard/BestPhotosCard';
import { SpeciesSummaryTiles } from '../../components/dashboard/SpeciesSummaryTiles';
import { MiniMapCard } from '../../components/dashboard/MiniMapCard';
import { imagesApi } from '../../api/images';
import { isWildlifeLabel } from '../../utils/labels';
import { filtersToSearchParams } from '../../lib/filter-url';
import { useDashboardFilters } from './useDashboardFilters';

export const DashboardExplore: React.FC = () => {
  const {
    projectId,
    dateRange,
    species,
    siteIdsFromTags,
    overview,
    filterValues,
    filterFields,
    onFilterChange,
    onClearAll,
  } = useDashboardFilters();

  const speciesParam = species || undefined;

  // Same query key as the filter hook, so this is served from cache.
  const { data: allSpeciesList } = useQuery({
    queryKey: ['species', projectId],
    queryFn: () => imagesApi.getSpecies(projectId),
    enabled: projectId !== undefined,
  });

  // With no species chosen the photo wall still has to avoid people and
  // vehicles, which projects usually blur, so it falls back to every wildlife
  // label rather than to no filter at all.
  const wildlifeSpecies = (allSpeciesList ?? [])
    .map((s) => String(s.value))
    .filter((value) => isWildlifeLabel(value))
    .join(',');
  const photoSpecies = species || wildlifeSpecies;

  // Independent events and mean group size come from the group size endpoint,
  // which excludes person, vehicle and empty by design, so both tiles read
  // zero for them. Hidden rather than made to work: a person walking past is
  // not a sighting with a group size, and a zero would look like a bug.
  const showSummaryTiles = !species || isWildlifeLabel(species);

  // Keys and encoding match the insights map page schema exactly, so the
  // mini map's click-through opens the full map with the same filters
  // already applied. Species is single-select here and multi there, hence
  // the one-element array.
  const mapSearch = filtersToSearchParams(
    {
      species: species ? [species] : undefined,
      date_from: dateRange.startDate || undefined,
      date_to: dateRange.endDate || undefined,
      site_ids: filterValues.site_ids,
      tags: filterValues.tags,
    },
    {
      species: 'string[]',
      date_from: 'date',
      date_to: 'date',
      site_ids: 'string[]',
      tags: 'string[]',
    },
  );
  // The insights map route is nested under the project, so the link must be
  // project-scoped. An absolute /insights/map matches no route and falls
  // through to the projects overview redirect.
  const mapBase = `/projects/${projectId}/insights/map`;
  const mapHref = mapSearch.toString() ? `${mapBase}?${mapSearch.toString()}` : mapBase;

  return (
    <div className="space-y-6">
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
      />

      {/* Two columns that each flow on their own, so a short card lets the one
          under it rise instead of leaving a gap that lines up with the taller
          column. Left leads with the photographs, right with the trend. The
          map is flex-1, so the right column fills to end level with the left. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <BestPhotosCard
            projectId={projectId}
            siteIds={siteIdsFromTags}
            species={photoSpecies}
            isAllSpecies={!species}
            startDate={dateRange.startDate || undefined}
            endDate={dateRange.endDate || undefined}
          />
          <ActivityPatternChart
            dateRange={dateRange}
            projectId={projectId}
            siteIds={siteIdsFromTags}
            species={speciesParam}
          />
          {showSummaryTiles && (
            <SpeciesSummaryTiles
              projectId={projectId}
              siteIds={siteIdsFromTags}
              species={photoSpecies}
              startDate={dateRange.startDate || undefined}
              endDate={dateRange.endDate || undefined}
              showNotes={false}
            />
          )}
        </div>
        <div className="flex flex-col gap-6">
          <DetectionTrendChart
            dateRange={dateRange}
            projectId={projectId}
            siteIds={siteIdsFromTags}
            species={speciesParam}
            projectFirstDate={overview?.first_image_date ?? null}
            projectLastDate={overview?.last_image_date ?? null}
          />
          {/* Sex, age class and behaviour share one card now. Separately they
              were three near-empty charts filling half the page. */}
          <MiniMapCard
            className="flex-1"
            projectId={projectId}
            siteIds={siteIdsFromTags}
            species={speciesParam}
            startDate={dateRange.startDate || undefined}
            endDate={dateRange.endDate || undefined}
            mapHref={mapHref}
          />
          <DemographicsCard
            dateRange={dateRange}
            projectId={projectId}
            siteIds={siteIdsFromTags}
            species={speciesParam}
          />
        </div>
      </div>
    </div>
  );
};
