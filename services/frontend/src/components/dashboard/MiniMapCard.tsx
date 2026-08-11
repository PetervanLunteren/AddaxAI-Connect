/**
 * Coarse detection map for the Explore tab. Prototype, built to decide
 * whether a small spatial overview earns its place here (TODO.md).
 *
 * Every site is a soft colored blob, darker means more detections per 100
 * trap-days. Data and colors come from the same endpoint and scale as the
 * insights map, so the two views can never disagree. The map is deliberately
 * dead as an instrument, no zoom, no pan, no popups, no legend. The whole
 * card is one link that opens the insights map with the same species, date
 * and site filters in its URL, where the real spatial exploration lives.
 *
 * react-leaflet treats bounds as mount-only, so the map re-mounts (key on
 * the feature set) whenever a filter changes the sites, to re-fit the view.
 *
 * The tile attribution is left off at this size; the identical tiles are
 * attributed one click away on the full map. Revisit if the card stays.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { statisticsApi } from '../../api/statistics';
import {
  getDetectionRateColor,
  calculateColorScaleDomain,
} from '../../utils/color-scale';
import { BASE_LAYERS } from '../map/BaseLayersControl';
import 'leaflet/dist/leaflet.css';

// Light base layer always, the blobs are the message and they read best on
// the quietest background. The user's stored base-layer choice applies to
// the real maps, not to this thumbnail.
const LIGHT_TILES = BASE_LAYERS[0];

interface MiniMapCardProps {
  projectId?: number;
  /** Comma-separated site ids, or undefined for all sites. */
  siteIds?: string;
  /** One species, or undefined for all species. */
  species?: string;
  startDate?: string;
  endDate?: string;
  /** Insights map URL carrying the current filters. */
  mapHref: string;
  /** Grid placement from the page. The card does not choose its own size. */
  className?: string;
}

export const MiniMapCard: React.FC<MiniMapCardProps> = ({
  projectId,
  siteIds,
  species,
  startDate,
  endDate,
  mapHref,
  className = '',
}) => {
  // Same query key shape as the insights map page, so navigating there after
  // an unfiltered look is served from cache.
  const filters = useMemo(
    () => ({
      species,
      start_date: startDate,
      end_date: endDate,
      site_ids: siteIds,
    }),
    [species, startDate, endDate, siteIds],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['detection-rate-map', projectId, filters],
    queryFn: () => statisticsApi.getDetectionRateMap(projectId, filters),
    enabled: projectId !== undefined,
  });

  const features = data?.features ?? [];

  const domain = useMemo(
    () =>
      calculateColorScaleDomain(
        features.map((f) => f.properties.detection_rate_per_100),
      ),
    [features],
  );

  const bounds = useMemo(() => {
    if (features.length === 0) return null;
    return latLngBounds(
      features.map(
        (f) =>
          [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [
            number,
            number,
          ],
      ),
    );
  }, [features]);

  // Re-mount the map when the visible sites change so the bounds re-fit.
  const mapKey = features.map((f) => f.id).join(',');

  return (
    <Card className={`group relative flex flex-col ${className}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Detection map</CardTitle>
        <p className="text-sm text-muted-foreground">
          {species
            ? 'Darker sites have more detections of this species per 100 trap-days'
            : 'Darker sites have more detections per 100 trap-days'}
        </p>
      </CardHeader>
      <CardContent className="flex-1 pb-6">
        <div className="relative h-full min-h-[200px] overflow-hidden rounded-md border">
          {isLoading ? (
            <div className="h-full animate-pulse bg-muted" />
          ) : !bounds ? (
            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
              No sites with a location in this selection
            </p>
          ) : (
            <MapContainer
              key={mapKey}
              bounds={bounds}
              boundsOptions={{ padding: [24, 24], maxZoom: 12 }}
              style={{ height: '100%', width: '100%', zIndex: 0 }}
              zoomControl={false}
              attributionControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              touchZoom={false}
              boxZoom={false}
              keyboard={false}
            >
              <TileLayer url={LIGHT_TILES.url} attribution={LIGHT_TILES.attribution} />
              {features.map((feature) => {
                const [lon, lat] = feature.geometry.coordinates;
                const color = getDetectionRateColor(
                  feature.properties.detection_rate_per_100,
                  domain.max,
                );
                // Two stacked circles per site, a wide translucent halo and a
                // solid core, which reads as a coarse heat surface without a
                // heatmap library.
                return (
                  <React.Fragment key={feature.id}>
                    <CircleMarker
                      center={[lat, lon]}
                      radius={16}
                      pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.3 }}
                      interactive={false}
                    />
                    <CircleMarker
                      center={[lat, lon]}
                      radius={5}
                      pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.85 }}
                      interactive={false}
                    />
                  </React.Fragment>
                );
              })}
            </MapContainer>
          )}
        </div>
      </CardContent>

      {/* One link over the whole card. The map ignores pointer events itself
          (every interaction is disabled), so this wins every click. */}
      <Link
        to={mapHref}
        aria-label="Open the full map with these filters"
        className="absolute inset-0 z-10 flex items-end justify-end p-4"
      >
        <span className="pointer-events-none rounded-full border bg-background/90 px-3 py-1 text-xs font-medium text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          Open the full map
        </span>
      </Link>
    </Card>
  );
};
