/**
 * Read-only satellite mini-map for the site slideout.
 *
 * Shows where the site sits. Deliberately minimal: always satellite, zoom
 * buttons only, no layer toggle, no fullscreen, no editing. Scroll-wheel zoom
 * is off so it does not hijack scrolling inside the slideout; drag to look
 * around, the zoom buttons to zoom.
 */
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import { MapAttribution, SATELLITE_LAYER as SATELLITE } from '../map/BaseLayersControl';
import { SITE_COLOR, dotIcon } from '../map/marker-style';
import 'leaflet/dist/leaflet.css';

const siteIcon = dotIcon(SITE_COLOR);

interface Props {
  latitude: number;
  longitude: number;
  height?: number;
}

export function SiteLocationMiniMap({ latitude, longitude, height = 200 }: Props) {
  return (
    <div className="rounded-md border overflow-hidden" style={{ height }}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={15}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%', zIndex: 0 }}
        attributionControl={false}
      >
        <MapAttribution />
        <TileLayer url={SATELLITE.url} attribution={SATELLITE.attribution} />
        <Marker position={[latitude, longitude]} icon={siteIcon} />
      </MapContainer>
    </div>
  );
}
