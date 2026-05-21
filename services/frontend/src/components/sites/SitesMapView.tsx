/**
 * Sites map view.
 *
 * Plots each site as a marker. Mirrors the cameras map (same base layers,
 * fit-to-bounds, fullscreen control, marker style). Clicking a marker opens
 * the site detail panel. Sites are physical places more than 100 m apart, so
 * no clustering is needed.
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import L from 'leaflet';
import { Map as MapIcon, Satellite, Navigation } from 'lucide-react';
import type { SiteListItem } from '../../api/sites';
import { FullscreenControl } from '../map/FullscreenControl';
import 'leaflet/dist/leaflet.css';

// Primary teal, matching the design system.
const SITE_COLOR = '#0f6064';

interface SitesMapViewProps {
  sites: SiteListItem[];
  onSiteClick: (siteId: number) => void;
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (points.length === 0 || fitted.current) return;
    map.fitBounds(latLngBounds(points), { padding: [30, 30] });
    fitted.current = true;
  }, [points, map]);
  return null;
}

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

export function SitesMapView({ sites, onSiteClick }: SitesMapViewProps) {
  const [baseLayer, setBaseLayer] = useState(
    () => localStorage.getItem('sites-map-baselayer') || 'positron',
  );
  useEffect(() => {
    localStorage.setItem('sites-map-baselayer', baseLayer);
  }, [baseLayer]);

  const sitesWithLocation = useMemo(
    () => sites.filter((s) => s.latitude != null && s.longitude != null),
    [sites],
  );

  const points = useMemo<[number, number][]>(
    () => sitesWithLocation.map((s) => [s.latitude as number, s.longitude as number]),
    [sitesWithLocation],
  );

  const center = useMemo<[number, number]>(() => {
    if (points.length === 0) return [52.0, 5.0];
    const lat = points.reduce((a, p) => a + p[0], 0) / points.length;
    const lon = points.reduce((a, p) => a + p[1], 0) / points.length;
    return [lat, lon];
  }, [points]);

  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'site-marker-icon',
        html: `<div style="
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background-color: ${SITE_COLOR};
          border: 2px solid #555555;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    [],
  );

  const tileLayerConfig = getTileLayerConfig(baseLayer);

  const layerButton = (value: string, title: string, Icon: typeof MapIcon, rounded: string) => (
    <button
      type="button"
      onClick={() => setBaseLayer(value)}
      title={title}
      aria-label={title}
      className={`flex-1 h-10 px-3 text-sm font-medium border flex items-center justify-center ${rounded} ${
        baseLayer === value
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  if (sitesWithLocation.length === 0) {
    return (
      <div className="flex items-center justify-center h-[500px] bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-muted-foreground">No sites with location data to display.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mb-4 p-4 bg-white rounded-lg border border-gray-200">
        <label className="block text-sm font-medium text-gray-700 mb-1">Map style</label>
        <div className="flex w-full max-w-xs rounded-md shadow-sm" role="group">
          {layerButton('positron', 'Light', MapIcon, 'rounded-l-md')}
          {layerButton('satellite', 'Satellite', Satellite, 'border-l-0')}
          {layerButton('osm', 'Street map', Navigation, 'rounded-r-md border-l-0')}
        </div>
      </div>

      <MapContainer
        center={center}
        zoom={12}
        style={{ height: '500px', width: '100%', zIndex: 0 }}
        className="rounded-lg border border-gray-200"
      >
        <TileLayer
          key={baseLayer}
          attribution={tileLayerConfig.attribution}
          url={tileLayerConfig.url}
        />
        <FitBounds points={points} />
        {sitesWithLocation.map((s) => (
          <Marker
            key={s.id}
            position={[s.latitude as number, s.longitude as number]}
            icon={icon}
            eventHandlers={{ click: () => onSiteClick(s.id) }}
          >
            <Tooltip>{s.name}</Tooltip>
          </Marker>
        ))}
        <FullscreenControl />
      </MapContainer>
    </div>
  );
}
