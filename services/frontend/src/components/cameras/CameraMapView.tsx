/**
 * Camera map view component
 * Displays cameras on a map with markers colored by status, battery, or signal
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import type { Camera } from '../../api/types';
import { type ColorByMetric } from '../../utils/camera-colors';
import { SpiderfiedCameraLayer } from './SpiderfiedCameraLayer';
import { CameraMapLegend } from './CameraMapLegend';
import { CameraMapControls } from './CameraMapControls';
import 'leaflet/dist/leaflet.css';

interface CameraMapViewProps {
  cameras: Camera[];
  onCameraClick: (camera: Camera) => void;
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (points.length === 0 || fitted.current) return;
    map.fitBounds(latLngBounds(points), { padding: [20, 20] });
    fitted.current = true;
  }, [points, map]);
  return null;
}

export function CameraMapView({ cameras, onCameraClick }: CameraMapViewProps) {
  // State with localStorage persistence
  const [colorBy, setColorBy] = useState<ColorByMetric>(() => {
    const saved = localStorage.getItem('cameras-map-color-by');
    if (saved === 'status' || saved === 'battery' || saved === 'signal') {
      return saved;
    }
    return 'status';
  });

  const [baseLayer, setBaseLayer] = useState(() => {
    const saved = localStorage.getItem('cameras-map-baselayer');
    return saved || 'positron';
  });

  // Persist preferences
  useEffect(() => {
    localStorage.setItem('cameras-map-color-by', colorBy);
  }, [colorBy]);

  useEffect(() => {
    localStorage.setItem('cameras-map-baselayer', baseLayer);
  }, [baseLayer]);

  // Filter cameras by location
  const camerasWithLocation = useMemo(
    () => cameras.filter((c) => c.location !== null),
    [cameras]
  );

  const camerasWithoutLocation = useMemo(
    () => cameras.filter((c) => c.location === null),
    [cameras]
  );

  // Calculate map center from camera locations
  const mapCenter = useMemo<[number, number]>(() => {
    if (camerasWithLocation.length === 0) {
      return [52.0, 5.0]; // Default center (Netherlands)
    }

    const lats = camerasWithLocation.map((c) => c.location!.lat);
    const lons = camerasWithLocation.map((c) => c.location!.lon);

    const avgLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
    const avgLon = lons.reduce((sum, lon) => sum + lon, 0) / lons.length;

    return [avgLat, avgLon];
  }, [camerasWithLocation]);

  const fitBoundsPoints = useMemo<[number, number][]>(() => {
    return camerasWithLocation.map((c) => [c.location!.lat, c.location!.lon] as [number, number]);
  }, [camerasWithLocation]);

  // Tile layer configuration
  const getTileLayerConfig = () => {
    switch (baseLayer) {
      case 'positron':
        return {
          url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        };
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
  };

  const tileLayerConfig = getTileLayerConfig();

  // Handle empty state
  if (camerasWithLocation.length === 0 && camerasWithoutLocation.length === 0) {
    return (
      <div className="flex items-center justify-center h-[500px] bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-muted-foreground">No cameras to display.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <CameraMapControls
        colorBy={colorBy}
        onColorByChange={setColorBy}
        baseLayer={baseLayer}
        onBaseLayerChange={setBaseLayer}
      />

      {camerasWithLocation.length > 0 ? (
        <MapContainer
          center={mapCenter}
          zoom={12}
          style={{ height: '500px', width: '100%', zIndex: 0 }}
          className="rounded-lg border border-gray-200"
        >
          <TileLayer
            key={baseLayer}
            attribution={tileLayerConfig.attribution}
            url={tileLayerConfig.url}
          />
          <FitBounds points={fitBoundsPoints} />

          <SpiderfiedCameraLayer
            cameras={camerasWithLocation}
            colorBy={colorBy}
            onCameraClick={onCameraClick}
          />

          <CameraMapLegend colorBy={colorBy} />
        </MapContainer>
      ) : (
        <div className="flex items-center justify-center h-[500px] bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-muted-foreground">
            No cameras with location data to display on map.
          </p>
        </div>
      )}

      {/* Cameras without location */}
      {camerasWithoutLocation.length > 0 && (
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800">
            <strong>
              {camerasWithoutLocation.length} camera
              {camerasWithoutLocation.length !== 1 ? 's' : ''}
            </strong>{' '}
            without location data:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {camerasWithoutLocation.map((camera) => (
              <button
                key={camera.id}
                onClick={() => onCameraClick(camera)}
                className="text-xs px-2 py-1 bg-white border border-amber-300 rounded hover:bg-amber-100 transition-colors"
              >
                {camera.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
