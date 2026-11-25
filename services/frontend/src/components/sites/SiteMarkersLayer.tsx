/**
 * Site pins on a map: a round marker per site at its real spot, with its
 * name as tooltip. Shared by the Sites map, the moves check and the site
 * pickers. Must be used inside a MapContainer.
 *
 * Pins that overlap stay where they are; zoom in to tell them apart, as on
 * any map. They are not spread out: that moved pins to spots where nothing
 * stands. It was made for cameras on one pole, which are one site now, and
 * two sites a few metres apart should be merged.
 */
import { Marker, Tooltip } from 'react-leaflet';
import { SITE_COLOR, dotIcon } from '../map/marker-style';

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
  return (
    <>
      {sites.filter((s) => s.latitude != null && s.longitude != null).map((item) => (
        <Marker
          key={item.id}
          position={[item.latitude!, item.longitude!]}
          icon={dotIcon(colorFor(item), 16, isFaded(item))}
          eventHandlers={{ click: () => onSiteClick(item.id) }}
        >
          <Tooltip>{item.name}</Tooltip>
        </Marker>
      ))}
    </>
  );
}
