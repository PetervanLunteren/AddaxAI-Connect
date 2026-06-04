/**
 * Generic spiderfy hook: spreads map markers that overlap on screen.
 *
 * Groups items whose pixel positions are within a threshold (so it adapts to
 * zoom), then fans each group out in a circle and reports a leg back to the
 * real spot. Used by both the cameras map (several cameras share one site) and
 * the sites map (sub-100 m sites, e.g. cameras on one pole). Must be called
 * inside a react-leaflet <MapContainer>.
 */
import { useState, useMemo } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';

export interface SpiderPosition {
  lat: number;
  lon: number;
}

export interface SpiderfiedResult<T> {
  item: T;
  displayPosition: SpiderPosition;
  realPosition: SpiderPosition;
  isSpiderfied: boolean;
}

export interface SpiderLeg {
  id: string | number;
  displayPosition: SpiderPosition;
  realPosition: SpiderPosition;
}

interface SpiderfyOptions {
  /** Pixel distance threshold for grouping overlapping markers (default: 30). */
  proximityThresholdPixels?: number;
  /** Pixel radius for spreading a group in a circle (default: 20). */
  spreadRadiusPixels?: number;
}

const DEFAULT_PROXIMITY_THRESHOLD = 30;
const DEFAULT_SPREAD_RADIUS = 20;

function pixelDistance(map: LeafletMap, a: SpiderPosition, b: SpiderPosition): number {
  const pa = map.latLngToContainerPoint([a.lat, a.lon]);
  const pb = map.latLngToContainerPoint([b.lat, b.lon]);
  const dx = pa.x - pb.x;
  const dy = pa.y - pb.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Union-Find grouping of indices whose positions are within thresholdPixels.
function groupByProximity(
  map: LeafletMap,
  positions: SpiderPosition[],
  thresholdPixels: number,
): number[][] {
  const n = positions.length;
  if (n === 0) return [];

  const parent = positions.map((_, i) => i);
  const rank = new Array(n).fill(0);

  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number): void => {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) return;
    if (rank[ri] < rank[rj]) parent[ri] = rj;
    else if (rank[ri] > rank[rj]) parent[rj] = ri;
    else {
      parent[rj] = ri;
      rank[ri]++;
    }
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (pixelDistance(map, positions[i], positions[j]) <= thresholdPixels) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  return Array.from(groups.values());
}

export function useSpiderfied<T>(
  items: T[],
  getPosition: (item: T) => SpiderPosition | null,
  getId: (item: T) => string | number,
  options: SpiderfyOptions = {},
): { spread: SpiderfiedResult<T>[]; legs: SpiderLeg[] } {
  const map = useMap();
  const [zoomLevel, setZoomLevel] = useState(() => map.getZoom());

  const thresholdPixels = options.proximityThresholdPixels ?? DEFAULT_PROXIMITY_THRESHOLD;
  const spreadRadius = options.spreadRadiusPixels ?? DEFAULT_SPREAD_RADIUS;

  useMapEvents({
    zoomend: () => setZoomLevel(map.getZoom()),
  });

  const located = useMemo(() => {
    const out: { item: T; position: SpiderPosition }[] = [];
    for (const item of items) {
      const position = getPosition(item);
      if (position) out.push({ item, position });
    }
    return out;
    // getPosition/getId are stable enough for this use; key on items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return useMemo(() => {
    const groups = groupByProximity(
      map,
      located.map((l) => l.position),
      thresholdPixels,
    );

    const spread: SpiderfiedResult<T>[] = [];
    const legs: SpiderLeg[] = [];

    for (const indices of groups) {
      if (indices.length === 1) {
        const { item, position } = located[indices[0]];
        spread.push({ item, displayPosition: position, realPosition: position, isSpiderfied: false });
        continue;
      }

      const members = indices.map((i) => located[i]);
      const center: SpiderPosition = {
        lat: members.reduce((s, m) => s + m.position.lat, 0) / members.length,
        lon: members.reduce((s, m) => s + m.position.lon, 0) / members.length,
      };
      const centerPoint = map.latLngToContainerPoint([center.lat, center.lon]);
      const angleStep = (2 * Math.PI) / members.length;
      const startAngle = -Math.PI / 2; // 12 o'clock

      members.forEach((m, i) => {
        const angle = startAngle + i * angleStep;
        const displayLatLng = map.containerPointToLatLng([
          centerPoint.x + spreadRadius * Math.cos(angle),
          centerPoint.y + spreadRadius * Math.sin(angle),
        ]);
        const displayPosition: SpiderPosition = { lat: displayLatLng.lat, lon: displayLatLng.lng };
        spread.push({ item: m.item, displayPosition, realPosition: m.position, isSpiderfied: true });
        legs.push({ id: getId(m.item), displayPosition, realPosition: m.position });
      });
    }

    return { spread, legs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, zoomLevel, map, thresholdPixels, spreadRadius]);
}
