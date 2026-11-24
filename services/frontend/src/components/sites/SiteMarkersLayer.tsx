/**
 * Site pins on a map: a round marker per site with its name as tooltip,
 * spread out where pins overlap (sites under 100 m apart exist, e.g. cameras
 * on one pole). Shared by the Sites map and the moves check. Must be
 * used inside a MapContainer.
 */
import { Marker, Tooltip } from 'react-leaflet';
import { SITE_COLOR, dotIcon } from '../map/marker-style';
import { SpiderLegLine } from '../map/SpiderLegLine';
import { useSpiderfied } from '../../hooks/useSpiderfied';

export { SITE_COLOR };

export interface SitePin {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

export function SiteMarkersLayer<S extends SitePin>({
  sites,
  onSiteClick,
  colorFor = () => SITE_COLOR,
  isFaded = () => false,
}: {
  sites: S[];
  onSiteClick: (siteId: number) => void;
  colorFor?: (site: S) => string;
  isFaded?: (site: S) => boolean;
}) {
  const { spread, legs } = useSpiderfied(
    sites,
    (s) => (s.latitude != null && s.longitude != null ? { lat: s.latitude, lon: s.longitude } : null),
    (s) => s.id,
    { proximityThresholdPixels: 10, spreadRadiusPixels: 20 },
  );
  return (
    <>
      {legs.map((leg) => (
        <SpiderLegLine key={`leg-${leg.id}`} leg={leg} />
      ))}
      {spread.map(({ item, displayPosition }) => (
        <Marker
          key={item.id}
          position={[displayPosition.lat, displayPosition.lon]}
          icon={dotIcon(colorFor(item), 16, isFaded(item))}
          eventHandlers={{ click: () => onSiteClick(item.id) }}
        >
          <Tooltip>{item.name}</Tooltip>
        </Marker>
      ))}
    </>
  );
}
