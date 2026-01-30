/**
 * Detection rate map component
 * Displays camera deployments with detection rates as colored markers or hexbins
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Hexagon } from 'lucide-react';
import { statisticsApi } from '../../api/statistics';
import type { DetectionRateMapFilters } from '../../api/types';
import {
  getDetectionRateColor,
  calculateColorScaleDomain,
} from '../../utils/color-scale';
import { DeploymentMarker } from './DeploymentMarker';
import { HexbinLayer } from './HexbinLayer';
import { MapLegend } from './MapLegend';
import { MapControls } from './MapControls';
import { getHexCellSize } from '../../utils/hex-grid';
import { Button } from '../ui/Button';
import 'leaflet/dist/leaflet.css';

type ViewMode = 'points' | 'hexbins';

/**
 * Component to track zoom level changes
 */
function ZoomHandler({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const debounceTimerRef = useRef<NodeJS.Timeout>();

  useMapEvents({
    zoomend: (e) => {
      // Debounce zoom changes to avoid excessive hex regeneration
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        const zoom = e.target.getZoom();
        onZoomChange(zoom);
      }, 300);
    },
  });

  return null;
}

export function DetectionRateMap() {
  const [filters, setFilters] = useState<DetectionRateMapFilters>({});
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Restore view preference from localStorage
    const saved = localStorage.getItem('detection-map-view-mode');
    return (saved === 'hexbins' ? 'hexbins' : 'points') as ViewMode;
  });
  const [zoomLevel, setZoomLevel] = useState(10);

  // Save view mode preference
  useEffect(() => {
    localStorage.setItem('detection-map-view-mode', viewMode);
  }, [viewMode]);

  const handleZoomChange = useCallback((zoom: number) => {
    setZoomLevel(zoom);
  }, []);

  // Fetch detection rate map data
  const { data, isLoading, error } = useQuery({
    queryKey: ['detection-rate-map', filters],
    queryFn: () => statisticsApi.getDetectionRateMap(filters),
  });

  // Calculate color scale domain from data
  const colorDomain = useMemo(() => {
    if (!data?.features) return { min: 0, max: 0, p33: 0, p66: 0 };

    const rates = data.features.map((f) => f.properties.detection_rate_per_100);
    return calculateColorScaleDomain(rates);
  }, [data]);

  // Calculate map center (average of all deployment locations)
  const mapCenter = useMemo<[number, number]>(() => {
    if (!data?.features || data.features.length === 0) {
      return [52.0, 5.0]; // Default center (Netherlands)
    }

    const lats = data.features.map((f) => f.geometry.coordinates[1]);
    const lons = data.features.map((f) => f.geometry.coordinates[0]);

    const avgLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
    const avgLon = lons.reduce((sum, lon) => sum + lon, 0) / lons.length;

    return [avgLat, avgLon];
  }, [data]);

  // Get hex cell size for display (must be before early returns - Rules of Hooks!)
  // No need for useMemo since getHexCellSize is a trivial function
  const hexCellSize = getHexCellSize(zoomLevel);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <div className="text-gray-500">Loading map data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <div className="text-red-500">
          Failed to load map: {error instanceof Error ? error.message : 'unknown error'}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <MapControls filters={filters} onFiltersChange={setFilters} />

      {/* View mode toggle */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setViewMode('points')}
            variant={viewMode === 'points' ? 'default' : 'outline'}
            size="sm"
            className="flex items-center gap-2"
          >
            <MapPin className="h-4 w-4" />
            Points
          </Button>
          <Button
            onClick={() => setViewMode('hexbins')}
            variant={viewMode === 'hexbins' ? 'default' : 'outline'}
            size="sm"
            className="flex items-center gap-2"
          >
            <Hexagon className="h-4 w-4" />
            Hexbins
          </Button>
        </div>

        {viewMode === 'hexbins' && (
          <div className="text-sm text-gray-600">
            Cell size: {hexCellSize}km hexagons
          </div>
        )}
      </div>

      <MapContainer
        center={mapCenter}
        zoom={10}
        style={{ height: '600px', width: '100%' }}
        className="rounded-lg border border-gray-200"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ZoomHandler onZoomChange={handleZoomChange} />

        {/* Render point markers or hexbin layer based on view mode */}
        {viewMode === 'points' ? (
          data?.features.map((feature) => {
            const color = getDetectionRateColor(
              feature.properties.detection_rate_per_100,
              colorDomain.max
            );

            return (
              <DeploymentMarker
                key={feature.id}
                feature={feature}
                color={color}
              />
            );
          })
        ) : (
          data?.features && (
            <HexbinLayer
              deployments={data.features}
              zoomLevel={zoomLevel}
              maxDetectionRate={colorDomain.max}
            />
          )
        )}

        <MapLegend domain={colorDomain} />
      </MapContainer>

      {data?.features && (
        <div className="mt-2 text-sm text-gray-600">
          {viewMode === 'points' ? (
            <>
              Showing {data.features.length} deployment{data.features.length !== 1 ? 's' : ''}
            </>
          ) : (
            <>
              Aggregating {data.features.length} deployment{data.features.length !== 1 ? 's' : ''} into hexagonal cells
            </>
          )}
        </div>
      )}
    </div>
  );
}
