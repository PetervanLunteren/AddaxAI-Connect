/**
 * Detection rate map component
 * Displays camera deployments with detection rates as colored markers or hexbins
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import { statisticsApi } from '../../api/statistics';
import type { DetectionRateMapFilters } from '../../api/types';
import {
  getDetectionRateColor,
  calculateColorScaleDomain,
} from '../../utils/color-scale';
import { DeploymentMarker } from './DeploymentMarker';
import { HexbinLayer } from './HexbinLayer';
import { ClusterLayer } from './ClusterLayer';
import { DefaultClusterLayer } from './DefaultClusterLayer';
import { MapLegend } from './MapLegend';
import { MapControls } from './MapControls';
import 'leaflet/dist/leaflet.css';

type ViewMode = 'points' | 'hexbins' | 'clusters' | 'default-clusters';

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
  const [baseLayer, setBaseLayer] = useState(() => {
    // Restore baselayer preference from localStorage
    const saved = localStorage.getItem('detection-map-baselayer');
    return saved || 'positron';
  });

  // Save view mode preference
  useEffect(() => {
    localStorage.setItem('detection-map-view-mode', viewMode);
  }, [viewMode]);

  // Save baselayer preference
  useEffect(() => {
    localStorage.setItem('detection-map-baselayer', baseLayer);
  }, [baseLayer]);

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

  // Get tile layer configuration based on selected baselayer
  const getTileLayerConfig = () => {
    switch (baseLayer) {
      case 'positron':
        return {
          url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        };
      case 'satellite':
        return {
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        };
      case 'osm':
        return {
          url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        };
      default:
        return {
          url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        };
    }
  };

  const tileLayerConfig = getTileLayerConfig();

  return (
    <div className="relative">
      <MapControls
        filters={filters}
        onFiltersChange={setFilters}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        baseLayer={baseLayer}
        onBaseLayerChange={setBaseLayer}
      />

      <MapContainer
        center={mapCenter}
        zoom={10}
        style={{ height: '600px', width: '100%' }}
        className="rounded-lg border border-gray-200"
      >
        <TileLayer
          key={baseLayer}
          attribution={tileLayerConfig.attribution}
          url={tileLayerConfig.url}
        />

        <ZoomHandler onZoomChange={handleZoomChange} />

        {/* Render markers, clusters, or hexbin layer based on view mode */}
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
        ) : viewMode === 'clusters' ? (
          data?.features && (
            <ClusterLayer
              deployments={data.features}
              maxDetectionRate={colorDomain.max}
              getMarkerColor={(feature) =>
                getDetectionRateColor(
                  feature.properties.detection_rate_per_100,
                  colorDomain.max
                )
              }
            />
          )
        ) : viewMode === 'default-clusters' ? (
          data?.features && (
            <DefaultClusterLayer
              deployments={data.features}
              getMarkerColor={(feature) =>
                getDetectionRateColor(
                  feature.properties.detection_rate_per_100,
                  colorDomain.max
                )
              }
            />
          )
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
    </div>
  );
}
