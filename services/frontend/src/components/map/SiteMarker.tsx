/**
 * Site marker component
 * Displays a single site as a colored circle marker on the detection-rate map
 */
import { CircleMarker, Popup } from 'react-leaflet';
import type { SiteFeature } from '../../api/types';
import type { MapMetric } from '../../utils/map-metrics';
import { SitePopup } from './SitePopup';

interface SiteMarkerProps {
  feature: SiteFeature;
  color: string;
  metric: MapMetric;
}

export function SiteMarker({ feature, color, metric }: SiteMarkerProps) {
  const [lat, lon] = [
    feature.geometry.coordinates[1],
    feature.geometry.coordinates[0],
  ];

  // Hollow circle when the site has no data for this metric, so it reads as
  // "covered, nothing seen" instead of blending with the low end of the
  // colour gradient.
  const isZero = metric.isEmpty(feature.properties);

  return (
    <CircleMarker
      center={[lat, lon]}
      radius={8}
      pathOptions={{
        fillColor: color,
        fillOpacity: isZero ? 0 : 0.7,
        color: '#555555', // Dark grey border to match hexagons
        weight: isZero ? 2 : 1,
        opacity: 1,
      }}
    >
      <Popup>
        <SitePopup properties={feature.properties} metric={metric} />
      </Popup>
    </CircleMarker>
  );
}
