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
  } = useDashboardFilters('explore');

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

  return (
    <div className="space-y-6">
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
      />

      <BestPhotosCard
        projectId={projectId}
        siteIds={siteIdsFromTags}
        species={photoSpecies}
        isAllSpecies={!species}
        startDate={dateRange.startDate || undefined}
        endDate={dateRange.endDate || undefined}
      />

      {/* The timeline gets the full width, it benefits most from the pixels. */}
      <DetectionTrendChart
        dateRange={dateRange}
        projectId={projectId}
        siteIds={siteIdsFromTags}
        species={speciesParam}
        projectFirstDate={overview?.first_image_date ?? null}
        projectLastDate={overview?.last_image_date ?? null}
      />

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
        <div className="flex flex-col gap-6">
          <DemographicsCard
            dateRange={dateRange}
            projectId={projectId}
            siteIds={siteIdsFromTags}
            species={speciesParam}
          />
          <SpeciesSummaryTiles
            projectId={projectId}
            siteIds={siteIdsFromTags}
            species={photoSpecies}
            isAllSpecies={!species}
            startDate={dateRange.startDate || undefined}
            endDate={dateRange.endDate || undefined}
          />
        </div>
      </div>
    </div>
  );
};
