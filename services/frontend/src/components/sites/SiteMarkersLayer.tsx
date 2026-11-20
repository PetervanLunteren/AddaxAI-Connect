/**
 * Site pins on a map: a round marker per site with its name as tooltip,
 * spread out where pins overlap (sites under 100 m apart exist, e.g. cameras
 * on one pole). Shared by the Sites map and the Camera updates page. Must be
 * used inside a MapContainer.
 */
import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { SpiderLegLine } from '../map/SpiderLegLine';
import { useSpiderfied } from '../../hooks/useSpiderfied';

// Primary teal, matching the design system. The plain place colour.
export const SITE_COLOR = '#0f6064';

export interface SitePin {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

// Icons are pure functions of their colour and size, so cache them to avoid
// rebuilding identical divIcons on every render.
const iconCache = new Map<string, L.DivIcon>();
function siteIcon(color: string, faded: boolean): L.DivIcon {
  const key = `${color}-${faded}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: 'site-marker-icon',
      html: `<div style="
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background-color: ${color};
        border: 2px solid #555555;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        opacity: ${faded ? 0.35 : 1};
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    iconCache.set(key, icon);
  }
  return icon;
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
          icon={siteIcon(colorFor(item), isFaded(item))}
          eventHandlers={{ click: () => onSiteClick(item.id) }}
        >
          <Tooltip>{item.name}</Tooltip>
        </Marker>
      ))}
    </>
  );
}
