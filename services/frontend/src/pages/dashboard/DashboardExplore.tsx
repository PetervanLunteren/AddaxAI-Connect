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
import { imagesApi } from '../../api/images';
import { isWildlifeLabel } from '../../utils/labels';
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

  return (
    <div className="space-y-6">
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
      />

      {/* Side by side, which is counter-intuitively better for the photographs
          too. Four across a full-width card spends most of the width on gaps
          and gives 230px tiles; two by two in half the width gives 267px. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BestPhotosCard
          projectId={projectId}
          siteIds={siteIdsFromTags}
          species={photoSpecies}
          isAllSpecies={!species}
          startDate={dateRange.startDate || undefined}
          endDate={dateRange.endDate || undefined}
        />
        <DetectionTrendChart
          dateRange={dateRange}
          projectId={projectId}
          siteIds={siteIdsFromTags}
          species={speciesParam}
          projectFirstDate={overview?.first_image_date ?? null}
          projectLastDate={overview?.last_image_date ?? null}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ActivityPatternChart
          dateRange={dateRange}
          projectId={projectId}
          siteIds={siteIdsFromTags}
          species={speciesParam}
        />
        {/* Sex, age class and behaviour share one card now. Separately they
            were three near-empty charts filling half the page.

            The two figures sit under it rather than above, because they fill
            the space the short demographic card leaves against the tall
            activity chart beside it. Above, they would have pushed both
            charts down for no gain. */}
        {/* self-start when the tiles are hidden, so the lone demographics card
            keeps its own height instead of stretching into white space. */}
        <div className={`flex flex-col gap-6 ${showSummaryTiles ? '' : 'self-start'}`}>
          <DemographicsCard
            dateRange={dateRange}
            projectId={projectId}
            siteIds={siteIdsFromTags}
            species={speciesParam}
          />
          {/* flex-1 so the two tiles absorb the slack left by the short
              demographics card, and this column ends level with the activity
              chart beside it. */}
          {showSummaryTiles && (
            <SpeciesSummaryTiles
              className="flex-1"
              projectId={projectId}
              siteIds={siteIdsFromTags}
              species={photoSpecies}
              startDate={dateRange.startDate || undefined}
              endDate={dateRange.endDate || undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
};
