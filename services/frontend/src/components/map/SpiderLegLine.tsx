/**
 * The thin line drawn from a spiderfied marker back toward its real location.
 * Shared by the camera and site spiderfy layers. Must be a child of a
 * react-leaflet <MapContainer>.
 */
import { Polyline } from 'react-leaflet';
import type { SpiderLeg } from '../../hooks/useSpiderfied';

const SPIDER_LEG_STYLE = {
  color: '#666666',
  weight: 1.5,
  opacity: 0.6,
};

function interpolate(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  ratio: number,
): [number, number] {
  return [
    start.lat + (end.lat - start.lat) * ratio,
    start.lon + (end.lon - start.lon) * ratio,
  ];
}

export function SpiderLegLine({ leg }: { leg: SpiderLeg }) {
  // From the marker (0%) to 80% of the way back, leaving a small gap at the spot.
  const startPoint = interpolate(leg.displayPosition, leg.realPosition, 0);
  const endPoint = interpolate(leg.displayPosition, leg.realPosition, 0.8);
  return <Polyline positions={[startPoint, endPoint]} pathOptions={SPIDER_LEG_STYLE} />;
}
