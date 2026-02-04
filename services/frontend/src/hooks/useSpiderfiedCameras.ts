/**
 * Hook for calculating spiderfied positions for overlapping camera markers
 * Groups cameras within a distance threshold and spreads them in a circle pattern
 */
import { useState, useMemo } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import type { Camera } from '../api/types';

// Types
interface Position {
  lat: number;
  lon: number;
}

interface CameraWithLocation extends Camera {
  location: { lat: number; lon: number };
}

interface CameraGroup {
  id: string;
  center: Position;
  cameras: CameraWithLocation[];
}

export interface SpiderfiedCamera {
  camera: CameraWithLocation;
  displayPosition: Position;
  realPosition: Position;
  isSpiderfied: boolean;
}

export interface SpiderLeg {
  cameraId: number;
  displayPosition: Position;
  realPosition: Position;
}

interface SpiderfyOptions {
  proximityThresholdMeters?: number;
  spreadRadiusPixels?: number;
}

const DEFAULT_PROXIMITY_THRESHOLD = 100; // meters
const DEFAULT_SPREAD_RADIUS = 40; // pixels

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @returns Distance in meters
 */
function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Group cameras that are within the proximity threshold using Union-Find
 */
function groupOverlappingCameras(
  cameras: CameraWithLocation[],
  thresholdMeters: number
): CameraGroup[] {
  const n = cameras.length;
  if (n === 0) return [];

  // Union-Find with path compression and union by rank
  const parent: number[] = cameras.map((_, i) => i);
  const rank: number[] = new Array(n).fill(0);

  function find(i: number): number {
    if (parent[i] !== i) {
      parent[i] = find(parent[i]);
    }
    return parent[i];
  }

  function union(i: number, j: number): void {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI === rootJ) return;

    if (rank[rootI] < rank[rootJ]) {
      parent[rootI] = rootJ;
    } else if (rank[rootI] > rank[rootJ]) {
      parent[rootJ] = rootI;
    } else {
      parent[rootJ] = rootI;
      rank[rootI]++;
    }
  }

  // Compare all pairs and union if within threshold
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = calculateDistanceMeters(
        cameras[i].location.lat,
        cameras[i].location.lon,
        cameras[j].location.lat,
        cameras[j].location.lon
      );

      if (dist <= thresholdMeters) {
        union(i, j);
      }
    }
  }

  // Collect cameras into groups
  const groupsMap = new Map<number, CameraWithLocation[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groupsMap.has(root)) {
      groupsMap.set(root, []);
    }
    groupsMap.get(root)!.push(cameras[i]);
  }

  // Build CameraGroup objects with centroids
  const groups: CameraGroup[] = [];
  let groupIndex = 0;

  for (const camerasInGroup of groupsMap.values()) {
    const avgLat =
      camerasInGroup.reduce((sum, c) => sum + c.location.lat, 0) /
      camerasInGroup.length;
    const avgLon =
      camerasInGroup.reduce((sum, c) => sum + c.location.lon, 0) /
      camerasInGroup.length;

    groups.push({
      id: `group-${groupIndex++}`,
      center: { lat: avgLat, lon: avgLon },
      cameras: camerasInGroup,
    });
  }

  return groups;
}

/**
 * Hook that calculates spiderfied positions for overlapping cameras
 *
 * @param cameras - Array of cameras (may include cameras without location)
 * @param options - Configuration options
 * @returns Spiderfied cameras with display positions and spider legs to draw
 */
export function useSpiderfiedCameras(
  cameras: Camera[],
  options: SpiderfyOptions = {}
): { spiderfiedCameras: SpiderfiedCamera[]; spiderLegs: SpiderLeg[] } {
  const map = useMap();
  const [zoomLevel, setZoomLevel] = useState(() => map.getZoom());

  const thresholdMeters =
    options.proximityThresholdMeters ?? DEFAULT_PROXIMITY_THRESHOLD;
  const spreadRadius = options.spreadRadiusPixels ?? DEFAULT_SPREAD_RADIUS;

  // Listen for zoom changes to recalculate positions
  useMapEvents({
    zoomend: () => {
      setZoomLevel(map.getZoom());
    },
  });

  // Filter to cameras with valid locations
  const camerasWithLocation = useMemo(
    () => cameras.filter((c): c is CameraWithLocation => c.location !== null),
    [cameras]
  );

  // Group overlapping cameras (only depends on cameras and threshold)
  const groups = useMemo(
    () => groupOverlappingCameras(camerasWithLocation, thresholdMeters),
    [camerasWithLocation, thresholdMeters]
  );

  // Calculate spiderfied positions (depends on groups, zoom, and spread radius)
  const result = useMemo(() => {
    const spiderfiedCameras: SpiderfiedCamera[] = [];
    const spiderLegs: SpiderLeg[] = [];

    for (const group of groups) {
      const count = group.cameras.length;

      if (count === 1) {
        // Single camera: no spreading needed
        const camera = group.cameras[0];
        spiderfiedCameras.push({
          camera,
          displayPosition: camera.location,
          realPosition: camera.location,
          isSpiderfied: false,
        });
      } else {
        // Multiple cameras: spread in circle
        const angleStep = (2 * Math.PI) / count;
        const startAngle = -Math.PI / 2; // Start from top (12 o'clock)

        // Convert center to pixel coordinates
        const centerPoint = map.latLngToContainerPoint([
          group.center.lat,
          group.center.lon,
        ]);

        for (let i = 0; i < count; i++) {
          const camera = group.cameras[i];
          const angle = startAngle + i * angleStep;

          // Calculate pixel offset
          const pixelOffsetX = spreadRadius * Math.cos(angle);
          const pixelOffsetY = spreadRadius * Math.sin(angle);

          // Convert back to lat/lon
          const displayLatLng = map.containerPointToLatLng([
            centerPoint.x + pixelOffsetX,
            centerPoint.y + pixelOffsetY,
          ]);

          const displayPosition: Position = {
            lat: displayLatLng.lat,
            lon: displayLatLng.lng,
          };

          spiderfiedCameras.push({
            camera,
            displayPosition,
            realPosition: camera.location,
            isSpiderfied: true,
          });

          spiderLegs.push({
            cameraId: camera.id,
            displayPosition,
            realPosition: camera.location,
          });
        }
      }
    }

    return { spiderfiedCameras, spiderLegs };
  }, [groups, zoomLevel, map, spreadRadius]);

  return result;
}
