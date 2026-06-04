/**
 * Read-only satellite mini-map for the site slideout.
 *
 * Shows where the site sits. Deliberately minimal: always satellite, zoom
 * buttons only, no layer toggle, no fullscreen, no editing. Scroll-wheel zoom
 * is off so it does not hijack scrolling inside the slideout; drag to look
 * around, the zoom buttons to zoom.
 */
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import { BASE_LAYERS } from '../map/BaseLayersControl';
import 'leaflet/dist/leaflet.css';

const SATELLITE = BASE_LAYERS.find((l) => l.key === 'satellite')!;
const SITE_COLOR = '#0f6064'; // primary teal, matches the other site maps

const siteIcon = L.divIcon({
  className: 'site-mini-marker',
  html: `<div style="
    width: 16px; height: 16px; border-radius: 50%;
    background-color: ${SITE_COLOR}; border: 2px solid #555555;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

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
      >
        <TileLayer url={SATELLITE.url} attribution={SATELLITE.attribution} />
        <Marker position={[latitude, longitude]} icon={siteIcon} />
      </MapContainer>
    </div>
  );
}
