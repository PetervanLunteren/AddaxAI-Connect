/**
 * Hexbin grid utilities for aggregating camera deployments
 */
import { hexGrid } from '@turf/hex-grid';
import { squareGrid } from '@turf/square-grid';
import { pointsWithinPolygon } from '@turf/points-within-polygon';
import { bbox as turfBbox } from '@turf/bbox';
import { point, featureCollection } from '@turf/helpers';
import type { Feature, FeatureCollection, Polygon, Point, BBox } from 'geojson';
import type { DeploymentFeature, DeploymentFeatureProperties } from '../api/types';

export interface HexCell {
  hex: Feature<Polygon>;
  deployments: DeploymentFeature[];
  trap_days: number;
  detection_count: number;
  detection_rate: number;
  detection_rate_per_100: number;
  camera_count: number;
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

  // Minimum cell size of 50m to avoid overly dense grids at high zoom
  // Maximum cell size of 500km to avoid issues at very low zoom
  return Math.min(500, Math.max(0.05, size));
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
    console.log('[generateHexGrid] Cell size too large for bbox, adjusted to:', cellSizeKm.toFixed(1), 'km');
  }

  console.log('[generateHexGrid] Bounds:', bounds, 'bbox:', bboxWidth.toFixed(3), 'x', bboxHeight.toFixed(3),
    'cellSizeKm:', cellSizeKm.toFixed(1), 'cellSizeDegrees:', cellSizeDegrees.toFixed(4));

  try {
    // Pad bounds to ensure grid covers all deployments
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
    console.log('[generateHexGrid] Generated', grid.features.length, 'hexagons');

    return grid;
  } catch (error) {
    console.error('[generateHexGrid] Error:', error);
    throw error;
  }
}

/**
 * Aggregate camera deployments into hex cells
 *
 * For each hex that contains at least one deployment:
 * - Sum trap-days across all deployments
 * - Sum detection counts across all deployments
 * - Calculate aggregated detection rate
 *
 * @param deployments - Array of deployment features from API
 * @param hexGrid - FeatureCollection of hexagon polygons
 * @returns Array of hex cells with aggregated metrics
 */
export function aggregateDeploymentsToHexes(
  deployments: DeploymentFeature[],
  hexGridCollection: FeatureCollection<Polygon>
): HexCell[] {
  // Convert deployment features to GeoJSON points for spatial join
  const deploymentPoints = featureCollection(
    deployments.map((deployment) => {
      const [lon, lat] = deployment.geometry.coordinates;
      return point([lon, lat], deployment.properties);
    })
  );

  console.log('[aggregateDeploymentsToHexes] Deployments count:', deployments.length);
  console.log('[aggregateDeploymentsToHexes] First 3 deployment coords:',
    deployments.slice(0, 3).map(d => d.geometry.coordinates));
  console.log('[aggregateDeploymentsToHexes] Hexagons count:', hexGridCollection.features.length);

  // Log first hex geometry to see its coordinates
  if (hexGridCollection.features.length > 0) {
    const firstHex = hexGridCollection.features[0];
    console.log('[aggregateDeploymentsToHexes] First hex geometry:',
      JSON.stringify(firstHex.geometry).substring(0, 200));
  }

  const hexCells: HexCell[] = [];

  // For each hex, find deployments within it and aggregate metrics
  for (const hex of hexGridCollection.features) {
    const deploymentsInHex = pointsWithinPolygon(deploymentPoints, hex);

    console.log('[aggregateDeploymentsToHexes] Hex bbox check, deployments found:',
      deploymentsInHex.features.length);

    // Extract original deployment features (with full properties)
    const deploymentFeaturesInHex: DeploymentFeature[] = deploymentsInHex.features.map((pt) => {
      const props = pt.properties as DeploymentFeatureProperties;
      const [lon, lat] = (pt.geometry as Point).coordinates;
      return {
        type: 'Feature' as const,
        id: `${props.camera_id}-${props.deployment_id}`,
        geometry: {
          type: 'Point' as const,
          coordinates: [lon, lat],
        },
        properties: props,
      };
    });

    // Aggregate metrics
    let totalTrapDays = 0;
    let totalDetections = 0;
    const uniqueCameras = new Set<number>();

    for (const deployment of deploymentFeaturesInHex) {
      totalTrapDays += deployment.properties.trap_days;
      totalDetections += deployment.properties.detection_count;
      uniqueCameras.add(deployment.properties.camera_id);
    }

    const detectionRate = totalTrapDays > 0 ? totalDetections / totalTrapDays : 0;
    const detectionRatePer100 = detectionRate * 100;

    hexCells.push({
      hex,
      deployments: deploymentFeaturesInHex,
      trap_days: totalTrapDays,
      detection_count: totalDetections,
      detection_rate: detectionRate,
      detection_rate_per_100: detectionRatePer100,
      camera_count: uniqueCameras.size,
    });
  }

  return hexCells;
}

/**
 * Calculate bounding box from array of deployment features
 * Returns [minLon, minLat, maxLon, maxLat]
 */
export function getDeploymentsBounds(deployments: DeploymentFeature[]): BBox {
  if (deployments.length === 0) {
    // Default to world bounds if no deployments
    return [-180, -90, 180, 90];
  }

  const points = featureCollection(
    deployments.map((d) => {
      const [lon, lat] = d.geometry.coordinates;
      return point([lon, lat]);
    })
  );

  return turfBbox(points);
}
