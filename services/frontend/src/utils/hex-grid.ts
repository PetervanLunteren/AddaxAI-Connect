/**
 * Hexbin grid utilities for aggregating sites on the detection-rate map.
 */
import { hexGrid } from '@turf/hex-grid';
import { squareGrid } from '@turf/square-grid';
import { pointsWithinPolygon } from '@turf/points-within-polygon';
import { bbox as turfBbox } from '@turf/bbox';
import { point, featureCollection } from '@turf/helpers';
import type { Feature, FeatureCollection, Polygon, Point, BBox } from 'geojson';
import type { SiteFeature, SiteFeatureProperties } from '../api/types';

export interface HexCell {
  hex: Feature<Polygon>;
  sites: SiteFeature[];
  trap_days: number;
  detection_count: number;
  detection_rate: number;
  detection_rate_per_100: number;
  site_count: number;
}

/**
 * Get appropriate hex cell size (radius in km) based on zoom level
 *
 * Maintains constant pixel size across all zoom levels by adjusting
 * geographic size (km) proportionally to map scale. Since Leaflet
 * doubles the scale with each zoom level, we halve the km size.
 *
 * @param zoomLevel - Current map zoom level (1-20)
 * @returns Cell size in kilometers
 */
export function getHexCellSize(zoomLevel: number): number {
  // Reference zoom level and desired size at that zoom
  const referenceZoom = 10;
  const referenceSizeKm = 1.5; // Desired size at zoom 10 (in km)

  // Size doubles/halves with each zoom level to maintain constant pixel size
  // Lower zoom (zoomed out) = larger km size
  // Higher zoom (zoomed in) = smaller km size
  const size = referenceSizeKm * Math.pow(2, referenceZoom - zoomLevel);

  // Maximum cell size of 500km to avoid issues at very low zoom
  // No minimum - since we only generate hexes for visible viewport, performance is not an issue
  return Math.min(500, size);
}

/**
 * Generate hexagonal grid covering the given bounding box
 *
 * @param bounds - [minLon, minLat, maxLon, maxLat] bounding box
 * @param zoomLevel - Current map zoom level
 * @returns FeatureCollection of hexagon polygons
 */
export function generateHexGrid(bounds: BBox, zoomLevel: number): FeatureCollection<Polygon> {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const bboxWidth = maxLon - minLon;
  const bboxHeight = maxLat - minLat;

  let cellSizeKm = getHexCellSize(zoomLevel);

  // Convert km to degrees (approximation: 1 degree latitude ≈ 111 km)
  // For hexagons, the "radius" is the distance from center to vertex
  let cellSizeDegrees = cellSizeKm / 111;

  // Ensure cell size is small enough to fit in the bounding box
  // Hex grid needs at least 2x the cell size in each dimension to generate hexagons
  const minBboxDimension = Math.min(bboxWidth, bboxHeight);
  const maxCellSizeDegrees = minBboxDimension / 3;

  if (cellSizeDegrees > maxCellSizeDegrees) {
    cellSizeDegrees = maxCellSizeDegrees;
    cellSizeKm = cellSizeDegrees * 111;
  }

  try {
    // Pad bounds to ensure grid covers all sites
    // Turf anchors hex lattice at top/left, so pad generously to guarantee coverage
    // Use 2x cell size to account for hex spacing and ensure full coverage
    const pad = cellSizeDegrees * 2;
    const paddedBounds: BBox = [
      minLon - pad,
      minLat - pad,
      maxLon + pad,
      maxLat + pad,
    ];

    // Use degrees to ensure grid aligns with bounding box
    const grid = hexGrid(paddedBounds, cellSizeDegrees, { units: 'degrees' });

    return grid;
  } catch (error) {
    console.error('[generateHexGrid] Error:', error);
    throw error;
  }
}

/**
 * Aggregate sites into hex cells.
 *
 * For each hex that contains at least one site:
 * - Sum trap-days across the sites in it
 * - Sum detection counts across the sites in it
 * - Calculate the aggregated detection rate
 *
 * @param sites - Array of site features from the API
 * @param hexGridCollection - FeatureCollection of hexagon polygons
 * @returns Array of hex cells with aggregated metrics
 */
export function aggregateSitesToHexes(
  sites: SiteFeature[],
  hexGridCollection: FeatureCollection<Polygon>
): HexCell[] {
  // Convert site features to GeoJSON points for the spatial join.
  const sitePoints = featureCollection(
    sites.map((site) => {
      const [lon, lat] = site.geometry.coordinates;
      return point([lon, lat], site.properties);
    })
  );

  const hexCells: HexCell[] = [];

  // For each hex, find the sites within it and aggregate their metrics.
  for (const hex of hexGridCollection.features) {
    const sitesInHex = pointsWithinPolygon(sitePoints, hex);

    if (sitesInHex.features.length === 0) {
      continue;
    }

    // Rebuild the original site features (with full properties).
    const siteFeaturesInHex: SiteFeature[] = sitesInHex.features.map((pt) => {
      const props = pt.properties as SiteFeatureProperties;
      const [lon, lat] = (pt.geometry as Point).coordinates;
      return {
        type: 'Feature' as const,
        id: `site-${props.site_id}`,
        geometry: {
          type: 'Point' as const,
          coordinates: [lon, lat],
        },
        properties: props,
      };
    });

    let totalTrapDays = 0;
    let totalDetections = 0;
    const uniqueSites = new Set<number>();

    for (const site of siteFeaturesInHex) {
      totalTrapDays += site.properties.trap_days;
      totalDetections += site.properties.detection_count;
      uniqueSites.add(site.properties.site_id);
    }

    const detectionRate = totalTrapDays > 0 ? totalDetections / totalTrapDays : 0;
    const detectionRatePer100 = detectionRate * 100;

    hexCells.push({
      hex,
      sites: siteFeaturesInHex,
      trap_days: totalTrapDays,
      detection_count: totalDetections,
      detection_rate: detectionRate,
      detection_rate_per_100: detectionRatePer100,
      site_count: uniqueSites.size,
    });
  }

  return hexCells;
}

/**
 * Calculate the bounding box from an array of site features.
 * Returns [minLon, minLat, maxLon, maxLat].
 */
export function getSiteBounds(sites: SiteFeature[]): BBox {
  if (sites.length === 0) {
    // Default to world bounds if there are no sites.
    return [-180, -90, 180, 90];
  }

  const points = featureCollection(
    sites.map((s) => {
      const [lon, lat] = s.geometry.coordinates;
      return point([lon, lat]);
    })
  );

  return turfBbox(points);
}
