/**
 * Detection rate map component
 * Displays sites with detection rates as colored markers, clusters or hexbins
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { MapContainer, useMap, useMapEvents } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { statisticsApi } from '../../api/statistics';
import { useProject } from '../../contexts/ProjectContext';
import { BaseLayersControl } from './BaseLayersControl';
import type { DetectionRateMapFilters } from '../../api/types';
import {
  getDetectionRateColor,
  calculateColorScaleDomain,
} from '../../utils/color-scale';
import {
  generateHexGrid,
  aggregateSitesToHexes,
} from '../../utils/hex-grid';
import { SiteMarker } from './SiteMarker';
import { HexbinLayer } from './HexbinLayer';
import { ClusterLayer } from './ClusterLayer';
import { MapLegend } from './MapLegend';
import { FullscreenControl } from './FullscreenControl';
import 'leaflet/dist/leaflet.css';

export type ViewMode = 'points' | 'hexbins' | 'clusters';

interface DetectionRateMapProps {
  filters: DetectionRateMapFilters;
  viewMode: ViewMode;
}

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

      // Clear any pending updates
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Mark that a zoom just occurred
      lastZoomTimeRef.current = now;

      // Update both zoom and bounds together
      debounceRef.current = setTimeout(() => {
        const bounds = e.target.getBounds();
        onZoomChange(zoom);
        onBoundsChange(bounds);
      }, 300);
    },
    moveend: (e) => {
      const now = Date.now();
      const timeSinceZoom = now - lastZoomTimeRef.current;

      // Don't respond to moveend if it's within 5000ms of a zoom event
      // Leaflet's zoom animation can take 3+ seconds and fires moveend when complete
      if (timeSinceZoom < 5000) {
        return;
      }

      // Clear any pending updates
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Only update bounds on pure pan (no zoom)
      debounceRef.current = setTimeout(() => {
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

export function DetectionRateMap({ filters, viewMode }: DetectionRateMapProps) {
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;

  const [zoomLevel, setZoomLevel] = useState(12);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);

  const handleZoomChange = useCallback((zoom: number) => {
    setZoomLevel(zoom);
  }, []);

  const handleBoundsChange = useCallback((bounds: L.LatLngBounds) => {
    setMapBounds(bounds);
  }, []);

  // Fetch detection rate map data
  const { data, isLoading, error } = useQuery({
    queryKey: ['detection-rate-map', projectId, filters],
    queryFn: () => statisticsApi.getDetectionRateMap(projectId, filters),
    enabled: projectId !== undefined,
  });

  // Filter sites to only those visible in current viewport
  const visibleSites = useMemo(() => {
    if (!data?.features || !mapBounds) return data?.features || [];

    return data.features.filter((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      return mapBounds.contains([lat, lon]);
    });
  }, [data, mapBounds]);

  // Calculate color scale domain from visible data only
  const colorDomain = useMemo(() => {
    if (!visibleSites || visibleSites.length === 0) {
      return { min: 0, max: 0, p33: 0, p66: 0 };
    }

    const rates = visibleSites.map((f) => f.properties.detection_rate_per_100);
    return calculateColorScaleDomain(rates);
  }, [visibleSites]);

  // Convert Leaflet bounds to bbox array for hex grid generation
  const bboxBounds = useMemo<[number, number, number, number] | null>(() => {
    if (!mapBounds) return null;
    const sw = mapBounds.getSouthWest();
    const ne = mapBounds.getNorthEast();
    return [sw.lng, sw.lat, ne.lng, ne.lat]; // [minLon, minLat, maxLon, maxLat]
  }, [mapBounds]);

  // Calculate hex cells count for description (only when in hexbins view)
  const hexCellsCount = useMemo(() => {
    if (viewMode !== 'hexbins' || !visibleSites || visibleSites.length === 0 || !bboxBounds) {
      return 0;
    }
    const hexGrid = generateHexGrid(bboxBounds, zoomLevel);
    const cells = aggregateSitesToHexes(visibleSites, hexGrid);
    return cells.length;
  }, [viewMode, visibleSites, bboxBounds, zoomLevel]);

  // Calculate map center (average of all site locations)
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

  const fitBoundsPoints = useMemo<[number, number][]>(() => {
    if (!data?.features || data.features.length === 0) return [];
    return data.features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number]);
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

  // Get description based on view mode
  const getViewDescription = () => {
    switch (viewMode) {
      case 'hexbins':
        return `Sites are grouped into ${hexCellsCount} hexagonal cells. Each hexagon's color shows the overall detection rate across the sites within it.`;
      case 'points':
        return `Each point represents one site. Color shows its detection rate per 100 trap-days.`;
      case 'clusters':
        return `Nearby sites are grouped into clusters. Each cluster shows the overall detection rate across the sites within it.`;
      default:
        return '';
    }
  };

  return (
    <div className="relative">
      <MapContainer
        center={mapCenter}
        zoom={12}
        style={{ height: '600px', width: '100%', zIndex: 0 }}
        className="rounded-lg border border-gray-200"
      >
        <BaseLayersControl />

        <MapEventHandler onZoomChange={handleZoomChange} onBoundsChange={handleBoundsChange} />
        <FitBounds points={fitBoundsPoints} />

        {/* Render markers, clusters, or hexbin layer based on view mode */}
        {viewMode === 'points' ? (
          visibleSites?.map((feature) => {
            const color = getDetectionRateColor(
              feature.properties.detection_rate_per_100,
              colorDomain.max
            );

            return (
              <SiteMarker
                key={feature.id}
                feature={feature}
                color={color}
              />
            );
          })
        ) : viewMode === 'clusters' ? (
          visibleSites && (
            <ClusterLayer
              sites={visibleSites}
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
          visibleSites && bboxBounds && (
            <HexbinLayer
              sites={visibleSites}
              zoomLevel={zoomLevel}
              mapBounds={bboxBounds}
              maxDetectionRate={colorDomain.max}
            />
          )
        )}

        <MapLegend domain={colorDomain} />
        <FullscreenControl />
      </MapContainer>

      {/* Info footer — mirrors the WebUI pattern: thin border-t row with an
          Info icon prefix and concise contextual metadata about what the
          viewer is currently seeing. */}
      {visibleSites && visibleSites.length > 0 && (
        <div className="mt-3 border-t pt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>
            {visibleSites.length} site{visibleSites.length === 1 ? '' : 's'} shown
          </span>
          <span aria-hidden="true">·</span>
          <span>{getViewDescription()}</span>
        </div>
      )}
    </div>
  );
}
