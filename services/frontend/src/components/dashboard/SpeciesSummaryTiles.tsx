/**
 * Four figures for whatever the Explore tab is currently showing: total
 * detections, how many independent events, the mean group size across them,
 * and how many sites are in view.
 *
 * The tab was photographs and charts with no numbers in it at all, so you
 * could look at red deer and still not know whether that meant forty events
 * or four hundred.
 *
 * The words are the app's own, not new ones. "Independent event", "MaxN" and
 * "individuals" are defined on the project settings page where the interval
 * is configured, and used again on the Group size insights page. An earlier
 * version of this file said "sightings" and "animals", which meant a reader
 * had to work out that they were the same things under different names, and
 * "animals" additionally read as a headcount of the forest rather than a sum
 * of appearances.
 *
 * Events and mean group size come from the group-size endpoint, which already
 * returns events and a histogram per species and honours the species, site and
 * date filters. The per-species distribution endpoint would have been wrong
 * here: it ignores dates, so the tiles would disagree with every chart beside
 * them the moment a date range was set.
 *
 * Individuals are summed from the histogram rather than from mean times
 * events, so the total is exact rather than a rounded product.
 *
 * Total detections and active sites come from the detection-rate-map endpoint,
 * the same one the map card uses, so summing its per-site counts gives a total
 * that agrees with the map, and the site count matches the "sites shown" line
 * on the full map. Both figures use the same species scope as the events, so
 * total detections stays a wildlife number next to them.
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
  startDate?: string;
  endDate?: string;
  /** Grid placement from the page. The tiles do not choose their own size. */
  className?: string;
  /** Drop the sub-line under each figure, for a tighter placement. */
  showNotes?: boolean;
}

export const SpeciesSummaryTiles: React.FC<SpeciesSummaryTilesProps> = ({
  projectId,
  siteIds,
  species,
  startDate,
  endDate,
  className = '',
  showNotes = true,
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

  // Same key shape and filters as the map card, so a single species view is
  // served from its cache instead of fetched twice.
  const { data: mapData, isLoading: mapLoading } = useQuery({
    queryKey: [
      'detection-rate-map',
      projectId,
      { species, start_date: startDate, end_date: endDate, site_ids: siteIds },
    ],
    queryFn: () =>
      statisticsApi.getDetectionRateMap(projectId, {
        species,
        start_date: startDate,
        end_date: endDate,
        site_ids: siteIds,
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

  const mapFeatures = mapData?.features ?? [];
  const totalDetections = mapFeatures.reduce(
    (sum, f) => sum + f.properties.detection_count,
    0,
  );
  const activeSites = mapFeatures.length;

  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      <StatTile
        label="Total detections"
        value={mapLoading ? '...' : totalDetections.toLocaleString()}
        note={showNotes ? 'Every detection in this selection' : undefined}
      />
      <StatTile
        label="Independent events"
        value={isLoading ? '...' : events.toLocaleString()}
        // The rule is the gap between consecutive photos, not a fixed window.
        // "Within 60 min counts once" implied the latter, so an animal
        // reappearing every 50 minutes all evening looked like six events
        // when it is one.
        note={
          !showNotes
            ? undefined
            : interval > 0
              ? `Same species at one place, a gap over ${interval} min starts a new event`
              : 'No grouping, every image is its own event'
        }
      />
      <StatTile
        label="Mean group size"
        value={isLoading ? '...' : meanGroup.toFixed(2)}
        // Individuals, not animals. The same deer photographed on forty
        // occasions counts forty times, so "animals" read as a headcount of
        // the forest. Matches the axis on the overview species chart.
        note={showNotes ? `${individuals.toLocaleString()} individuals counted` : undefined}
      />
      <StatTile
        label="Active sites"
        value={mapLoading ? '...' : activeSites.toLocaleString()}
        note={showNotes ? 'Sites with a camera deployed in this range' : undefined}
      />
    </div>
  );
};
