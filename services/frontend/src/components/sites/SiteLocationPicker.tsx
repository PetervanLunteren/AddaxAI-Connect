/**
 * Site location picker.
 *
 * Click the map to set a coordinate; an existing-sites layer shows context.
 * Mirrors the AddaxAI-WebUI add-site map UX, built on react-leaflet to match
 * the rest of this app (SitesMapView, CameraMapView). The parent owns the
 * lat/lon value and keeps manual number inputs in sync, so typing and clicking
 * both drive the same marker.
 */
import { useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import L from 'leaflet';
import { Map as MapIcon, Satellite, Navigation } from 'lucide-react';
import type { SiteListItem } from '../../api/sites';
import 'leaflet/dist/leaflet.css';

const SELECTED_COLOR = '#882000'; // destructive-ish, stands out from existing sites
const SITE_COLOR = '#0f6064'; // primary teal, matches SitesMapView

// Same three base layers as SitesMapView, so the picker and the sites map feel
// the same.
function getTileLayerConfig(baseLayer: string) {
  switch (baseLayer) {
    case 'satellite':
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      };
    case 'osm':
      return {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      };
    default:
      return {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      };
  }
}

interface Props {
  value: { lat: number; lon: number } | null;
  onChange: (lat: number, lon: number) => void;
  sites: SiteListItem[];
  excludeSiteId?: number;
  height?: number;
}

function markerIcon(color: string, size: number) {
  return L.divIcon({
    className: 'site-picker-marker',
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      background-color: ${color}; border: 2px solid #555555;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ClickToSet({ onChange }: { onChange: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Fit to the selected point plus existing sites, once, on first render with data.
function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  useMemo(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(latLngBounds(points), { padding: [30, 30] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function SiteLocationPicker({ value, onChange, sites, excludeSiteId, height = 320 }: Props) {
  const existing = useMemo(
    () =>
      sites.filter(
        (s) => s.id !== excludeSiteId && s.latitude != null && s.longitude != null,
      ),
    [sites, excludeSiteId],
  );

  const points = useMemo<[number, number][]>(() => {
    const pts = existing.map((s) => [s.latitude as number, s.longitude as number] as [number, number]);
    if (value) pts.push([value.lat, value.lon]);
    return pts;
  }, [existing, value]);

  const center = useMemo<[number, number]>(() => {
    if (value) return [value.lat, value.lon];
    if (points.length > 0) return points[0];
    return [52.0, 5.0];
  }, [value, points]);

  const selectedIcon = useMemo(() => markerIcon(SELECTED_COLOR, 18), []);
  const siteIcon = useMemo(() => markerIcon(SITE_COLOR, 14), []);

  const [baseLayer, setBaseLayer] = useState(
    () => localStorage.getItem('sites-map-baselayer') || 'positron',
  );
  const tileLayerConfig = getTileLayerConfig(baseLayer);

  const selectLayer = (value: string) => {
    setBaseLayer(value);
    localStorage.setItem('sites-map-baselayer', value);
  };

  const layerButton = (value: string, title: string, Icon: typeof MapIcon, rounded: string) => (
    <button
      type="button"
      onClick={() => selectLayer(value)}
      title={title}
      aria-label={title}
      className={`h-8 px-3 text-sm font-medium border flex items-center justify-center ${rounded} ${
        baseLayer === value
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex rounded-md shadow-sm w-min" role="group">
        {layerButton('positron', 'Light', MapIcon, 'rounded-l-md')}
        {layerButton('satellite', 'Satellite', Satellite, 'border-l-0')}
        {layerButton('osm', 'Street map', Navigation, 'rounded-r-md border-l-0')}
      </div>
      <div className="rounded-md border overflow-hidden" style={{ height }}>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%', zIndex: 0 }}
      >
        <TileLayer
          key={baseLayer}
          url={tileLayerConfig.url}
          attribution={tileLayerConfig.attribution}
        />
        <ClickToSet onChange={onChange} />
        <FitOnce points={points} />
        {existing.map((s) => (
          <Marker
            key={s.id}
            position={[s.latitude as number, s.longitude as number]}
            icon={siteIcon}
          >
            <Tooltip>{s.name}</Tooltip>
          </Marker>
        ))}
        {value && (
          <Marker
            position={[value.lat, value.lon]}
            icon={selectedIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = e.target.getLatLng();
                onChange(p.lat, p.lng);
              },
            }}
          />
        )}
      </MapContainer>
      </div>
    </div>
  );
}
