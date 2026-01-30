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
import { MapLegend } from './MapLegend';
import { MapControls } from './MapControls';
import 'leaflet/dist/leaflet.css';

type ViewMode = 'points' | 'hexbins' | 'clusters';

/**
 * Component to track zoom level and map bounds changes
 */
function MapEventHandler({
  onZoomChange,
  onBoundsChange
}: {
  onZoomChange: (zoom: number) => void;
  onBoundsChange: (bounds: L.LatLngBounds) => void;
}) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const lastZoomTimeRef = useRef<number>(0);

  const map = useMapEvents({
    zoomend: (e) => {
      const now = Date.now();
      const zoom = e.target.getZoom();
      console.log(`[MapEventHandler] zoomend fired`, {
        zoom,
        timestamp: now,
        hadPendingTimeout: !!debounceRef.current,
      });

      // Clear any pending updates
      if (debounceRef.current) {
        console.log(`[MapEventHandler] Clearing pending timeout from zoomend`);
        clearTimeout(debounceRef.current);
      }

      // Mark that a zoom just occurred
      lastZoomTimeRef.current = now;

      // Update both zoom and bounds together
      debounceRef.current = setTimeout(() => {
        console.log(`[MapEventHandler] zoomend timeout executing (300ms later)`, {
          zoom,
          timeSinceEvent: Date.now() - now,
        });
        const bounds = e.target.getBounds();
        onZoomChange(zoom);
        onBoundsChange(bounds);
      }, 300);
    },
    moveend: (e) => {
      const now = Date.now();
      const timeSinceZoom = now - lastZoomTimeRef.current;

      console.log(`[MapEventHandler] moveend fired`, {
        timestamp: now,
        timeSinceLastZoom: timeSinceZoom,
        willIgnore: timeSinceZoom < 500,
      });

      // Don't respond to moveend if it's within 500ms of a zoom event
      // (zoom triggers moveend, we don't want double updates)
      if (timeSinceZoom < 500) {
        console.log(`[MapEventHandler] Ignoring moveend (too soon after zoom)`);
        return;
      }

      // Clear any pending updates
      if (debounceRef.current) {
        console.log(`[MapEventHandler] Clearing pending timeout from moveend`);
        clearTimeout(debounceRef.current);
      }

      // Only update bounds on pure pan (no zoom)
      debounceRef.current = setTimeout(() => {
        console.log(`[MapEventHandler] moveend timeout executing (300ms later)`, {
          timeSinceEvent: Date.now() - now,
        });
        const bounds = e.target.getBounds();
        onBoundsChange(bounds);
      }, 300);
    },
  });

  // Initialize zoom and bounds on mount
  useEffect(() => {
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    onZoomChange(zoom);
    onBoundsChange(bounds);
  }, [map, onZoomChange, onBoundsChange]);

  return null;
}

export function DetectionRateMap() {
  console.log('=== DetectionRateMap component rendering ===');
  console.log('TIMESTAMP:', Date.now());

  const [filters, setFilters] = useState<DetectionRateMapFilters>({});
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Restore view preference from localStorage
    const saved = localStorage.getItem('detection-map-view-mode');
    if (saved === 'points' || saved === 'clusters' || saved === 'hexbins') {
      return saved as ViewMode;
    }
    return 'hexbins'; // Default to hexbins
  });
  const [zoomLevel, setZoomLevel] = useState(10);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
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
    console.log(`[DetectionRateMap] Setting zoom level to ${zoom}`);
    setZoomLevel(zoom);
  }, []);

  const handleBoundsChange = useCallback((bounds: L.LatLngBounds) => {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    console.log(`[DetectionRateMap] Setting map bounds`, {
      minLon: sw.lng,
      minLat: sw.lat,
      maxLon: ne.lng,
      maxLat: ne.lat,
    });
    setMapBounds(bounds);
  }, []);

  // Fetch detection rate map data
  const { data, isLoading, error } = useQuery({
    queryKey: ['detection-rate-map', filters],
    queryFn: () => statisticsApi.getDetectionRateMap(filters),
  });

  // Filter deployments to only those visible in current viewport
  const visibleDeployments = useMemo(() => {
    if (!data?.features || !mapBounds) return data?.features || [];

    const visible = data.features.filter((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      return mapBounds.contains([lat, lon]);
    });

    console.log(`[DetectionRateMap] Visible deployments recalculated`, {
      total: data.features.length,
      visible: visible.length,
      timestamp: Date.now(),
    });

    return visible;
  }, [data, mapBounds]);

  // Calculate color scale domain from visible data only
  const colorDomain = useMemo(() => {
    if (!visibleDeployments || visibleDeployments.length === 0) {
      return { min: 0, max: 0, p33: 0, p66: 0 };
    }

    const rates = visibleDeployments.map((f) => f.properties.detection_rate_per_100);
    return calculateColorScaleDomain(rates);
  }, [visibleDeployments]);

  // Convert Leaflet bounds to bbox array for hex grid generation
  const bboxBounds = useMemo<[number, number, number, number] | null>(() => {
    if (!mapBounds) return null;
    const sw = mapBounds.getSouthWest();
    const ne = mapBounds.getNorthEast();
    const bbox: [number, number, number, number] = [sw.lng, sw.lat, ne.lng, ne.lat];

    console.log(`[DetectionRateMap] bboxBounds recalculated`, {
      bbox,
      timestamp: Date.now(),
    });

    return bbox; // [minLon, minLat, maxLon, maxLat]
  }, [mapBounds]);

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

        <MapEventHandler onZoomChange={handleZoomChange} onBoundsChange={handleBoundsChange} />

        {/* Render markers, clusters, or hexbin layer based on view mode */}
        {viewMode === 'points' ? (
          visibleDeployments?.map((feature) => {
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
          visibleDeployments && (
            <ClusterLayer
              deployments={visibleDeployments}
              maxDetectionRate={colorDomain.max}
              getMarkerColor={(feature) =>
                getDetectionRateColor(
                  feature.properties.detection_rate_per_100,
                  colorDomain.max
                )
              }
            />
          )
        ) : (
          visibleDeployments && bboxBounds && (
            <HexbinLayer
              deployments={visibleDeployments}
              zoomLevel={zoomLevel}
              mapBounds={bboxBounds}
              maxDetectionRate={colorDomain.max}
            />
          )
        )}

        <MapLegend domain={colorDomain} />
      </MapContainer>
    </div>
  );
}
