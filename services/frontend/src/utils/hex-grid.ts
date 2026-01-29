/**
 * Hexbin grid utilities for aggregating camera deployments
 */
import { hexGrid } from '@turf/hex-grid';
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
 * Zoom levels:
 * 1-7:   50km hexagons (continental view)
 * 8-10:  20km hexagons (regional view)
 * 11-13:  5km hexagons (local view)
 * 14-16:  2km hexagons (detailed view)
 * 17+:    1km hexagons (close-up)
 */
export function getHexCellSize(zoomLevel: number): number {
  if (zoomLevel <= 7) return 50;
  if (zoomLevel <= 10) return 20;
  if (zoomLevel <= 13) return 5;
  if (zoomLevel <= 16) return 2;
  return 1;
}

/**
 * Generate hexagonal grid covering the given bounding box
 *
 * @param bounds - [minLon, minLat, maxLon, maxLat] bounding box
 * @param zoomLevel - Current map zoom level
 * @returns FeatureCollection of hexagon polygons
 */
export function generateHexGrid(bounds: BBox, zoomLevel: number): FeatureCollection<Polygon> {
  const cellSizeKm = getHexCellSize(zoomLevel);

  console.log('[generateHexGrid] Bounds:', bounds, 'cellSizeKm:', cellSizeKm);
  console.log('[generateHexGrid] Calling hexGrid with units=kilometers');

  try {
    // Try with kilometers first
    let grid = hexGrid(bounds, cellSizeKm, { units: 'kilometers' });
    console.log('[generateHexGrid] With kilometers:', grid.features.length, 'hexagons');

    // If that fails (0 features), try with miles
    if (grid.features.length === 0) {
      const cellSizeMiles = cellSizeKm * 0.621371;
      console.log('[generateHexGrid] Trying miles instead:', cellSizeMiles);
      grid = hexGrid(bounds, cellSizeMiles, { units: 'miles' });
      console.log('[generateHexGrid] With miles:', grid.features.length, 'hexagons');
    }

    // If still 0, try degrees with manual conversion
    if (grid.features.length === 0) {
      const cellSizeDegrees = cellSizeKm / 111;
      console.log('[generateHexGrid] Trying degrees:', cellSizeDegrees);
      grid = hexGrid(bounds, cellSizeDegrees, { units: 'degrees' });
      console.log('[generateHexGrid] With degrees:', grid.features.length, 'hexagons');
    }

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

  const hexCells: HexCell[] = [];

  // For each hex, find deployments within it and aggregate metrics
  for (const hex of hexGridCollection.features) {
    const deploymentsInHex = pointsWithinPolygon(deploymentPoints, hex);

    // Skip hexes with no deployments
    if (deploymentsInHex.features.length === 0) {
      continue;
    }

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
