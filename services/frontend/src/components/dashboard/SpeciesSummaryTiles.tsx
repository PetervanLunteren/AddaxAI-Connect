/**
 * Two figures for whatever the Explore tab is currently showing: how many
 * times it turned up, and how many animals came at once.
 *
 * The tab was photographs and charts with no numbers in it at all, so you
 * could look at red deer and still not know whether that meant forty
 * sightings or four hundred.
 *
 * Both come from the group-size endpoint, which already returns events and a
 * histogram per species and honours the species, site and date filters. The
 * per-species distribution endpoint would have been wrong here: it ignores
 * dates, so the tiles would disagree with every chart beside them the moment
 * a date range was set.
 *
 * Individuals are summed from the histogram rather than from mean times
 * events, so the total is exact rather than a rounded product.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { statisticsApi } from '../../api/statistics';
import { StatTile } from './StatTile';

interface SpeciesSummaryTilesProps {
  projectId?: number;
  siteIds?: string;
  /** One species, or the comma-separated wildlife list when none is chosen. */
  species: string;
  isAllSpecies: boolean;
  startDate?: string;
  endDate?: string;
}

export const SpeciesSummaryTiles: React.FC<SpeciesSummaryTilesProps> = ({
  projectId,
  siteIds,
  species,
  isAllSpecies,
  startDate,
  endDate,
}) => {
  const { data, isLoading } = useQuery({
    queryKey: ['statistics', 'group-size', projectId, siteIds, species, startDate, endDate],
    queryFn: () =>
      statisticsApi.getGroupSize(projectId, {
        species,
        site_ids: siteIds,
        start_date: startDate,
        end_date: endDate,
      }),
    enabled: projectId !== undefined && species.length > 0,
  });

  const rows = data?.species ?? [];
  const events = rows.reduce((sum, s) => sum + s.events, 0);
  const individuals = rows.reduce(
    (sum, s) => sum + s.histogram.reduce((n, bin) => n + bin.group_size * bin.events, 0),
    0,
  );
  const meanGroup = events > 0 ? individuals / events : 0;
  const interval = data?.metadata.independence_interval_minutes ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4">
      <StatTile
        label="Sightings"
        value={isLoading ? '...' : events.toLocaleString()}
        note={
          interval > 0
            ? `Repeat photos within ${interval} min count once`
            : 'Every image counts separately'
        }
      />
      <StatTile
        label="Average group size"
        value={isLoading ? '...' : meanGroup.toFixed(2)}
        note={
          isAllSpecies
            ? `${individuals.toLocaleString()} animals across all species`
            : `${individuals.toLocaleString()} animals in total`
        }
      />
    </div>
  );
};
