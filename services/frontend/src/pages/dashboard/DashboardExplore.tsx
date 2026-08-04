/**
 * Dashboard Explore tab: pick one species and study it.
 *
 * Holds every card whose endpoint accepts a species, so one filter drives
 * all of them. An empty species means all species, same as before the
 * per-card dropdowns were removed.
 */
import React from 'react';
import { FilterBar } from '../../components/ui/FilterBar';
import { ActivityPatternChart, DetectionTrendChart } from '../../components/dashboard';
import { DemographicChart } from '../../components/dashboard/DemographicChart';
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

  return (
    <div className="space-y-6">
      <FilterBar
        fields={filterFields}
        values={filterValues}
        onChange={onFilterChange}
        onClearAll={onClearAll}
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

      {/* Sex and age class are separate cards on purpose. They answer
          different questions, so a dropdown that shows one at a time would
          keep half of what people came here for out of sight. */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <ActivityPatternChart
          dateRange={dateRange}
          projectId={projectId}
          siteIds={siteIdsFromTags}
          species={speciesParam}
        />
        <DemographicChart
          field="sex"
          dateRange={dateRange}
          projectId={projectId}
          siteIds={siteIdsFromTags}
          species={speciesParam}
        />
      </div>

      <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
        <DemographicChart
          field="life_stage"
          dateRange={dateRange}
          projectId={projectId}
          siteIds={siteIdsFromTags}
          species={speciesParam}
        />
        <DemographicChart
          field="behavior"
          dateRange={dateRange}
          projectId={projectId}
          siteIds={siteIdsFromTags}
          species={speciesParam}
        />
      </div>
    </div>
  );
};
