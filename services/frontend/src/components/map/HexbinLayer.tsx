/**
 * Hexbin layer for detection rate map
 * Aggregates camera deployments into hexagonal cells
 */
import { useMemo, useCallback } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { FeatureCollection, Polygon, Feature } from 'geojson';
import type { Layer, PathOptions } from 'leaflet';
import { featureCollection } from '@turf/helpers';
import type { DeploymentFeature } from '../../api/types';
import {
  generateHexGrid,
  aggregateDeploymentsToHexes,
  getDeploymentsBounds,
  type HexCell,
} from '../../utils/hex-grid';
import { getDetectionRateColor } from '../../utils/color-scale';
import { renderToStaticMarkup } from 'react-dom/server';
import { HexPopup } from './HexPopup';

interface HexbinLayerProps {
  deployments: DeploymentFeature[];
  zoomLevel: number;
  maxDetectionRate?: number; // For color scale normalization
}

// Store hex cell data in feature properties for popup access
interface HexFeatureProperties {
  hexCell: HexCell;
  color: string;
  isZero: boolean;
}

export function HexbinLayer({ deployments, zoomLevel, maxDetectionRate }: HexbinLayerProps) {
  // Generate hex grid and aggregate deployments
  const hexCells = useMemo(() => {
    if (deployments.length === 0) {
      return [];
    }

    const bounds = getDeploymentsBounds(deployments) as [number, number, number, number];
    const hexGrid = generateHexGrid(bounds, zoomLevel);
    const cells = aggregateDeploymentsToHexes(deployments, hexGrid);

    return cells;
  }, [deployments, zoomLevel]);

  // Calculate max detection rate for color scale
  const maxRate = useMemo(() => {
    if (maxDetectionRate !== undefined) return maxDetectionRate;
    if (hexCells.length === 0) return 0;
    return Math.max(...hexCells.map((cell) => cell.detection_rate_per_100));
  }, [hexCells, maxDetectionRate]);

  // Create GeoJSON FeatureCollection with all hexagons
  const hexFeatureCollection = useMemo<FeatureCollection<Polygon, HexFeatureProperties>>(() => {
    const features = hexCells.map((hexCell) => {
      const isZero = hexCell.detection_count === 0;
      // Use color scale for all hexagons (including zeros)
      const color = getDetectionRateColor(hexCell.detection_rate_per_100, maxRate);

      return {
        ...hexCell.hex,
        properties: {
          hexCell,
          color,
          isZero,
        },
      };
    });

    return featureCollection(features) as FeatureCollection<Polygon, HexFeatureProperties>;
  }, [hexCells, maxRate]);

  // Stable style function using useCallback
  const styleFunction = useCallback((feature: Feature<Polygon, HexFeatureProperties> | undefined) => {
    const props = feature?.properties as HexFeatureProperties | undefined;
    if (!props) return {};

    // Use full opacity for all hexagons (zeros are real data - cameras deployed but no detections)
    return {
      fillColor: props.color,
      fillOpacity: 0.8,
      color: '#555555', // Dark grey border
      weight: 1,
      opacity: 0.8,
    };
  }, []); // No dependencies - uses data from feature properties

  // Stable onEachFeature function using useCallback
  const onEachFeatureHandler = useCallback((feature: Feature<Polygon, HexFeatureProperties>, layer: Layer) => {
    const props = feature.properties as HexFeatureProperties;
    // Only show popup for hexagons with deployments
    if (!props.isZero) {
      const popupContent = renderToStaticMarkup(<HexPopup hexCell={props.hexCell} />);
      layer.bindPopup(popupContent);
    }
  }, []); // No dependencies - uses data from feature properties

  if (hexCells.length === 0) {
    return null;
  }

  return (
    <GeoJSON
      key={`hexbin-${zoomLevel}-${hexCells.length}`}
      data={hexFeatureCollection}
      style={styleFunction}
      onEachFeature={onEachFeatureHandler}
    />
  );
}
