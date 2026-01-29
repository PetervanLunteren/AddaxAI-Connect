/**
 * Hexbin layer for detection rate map
 * Aggregates camera deployments into hexagonal cells
 */
import { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { FeatureCollection, Polygon } from 'geojson';
import type { Layer, PathOptions, LeafletMouseEvent } from 'leaflet';
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
    return aggregateDeploymentsToHexes(deployments, hexGrid);
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

  if (hexCells.length === 0) {
    return null;
  }

  return (
    <GeoJSON
      data={hexFeatureCollection}
      style={(feature) => {
        const props = feature?.properties as HexFeatureProperties | undefined;
        if (!props) return {};

        return {
          fillColor: props.color,
          fillOpacity: props.isZero ? 0.2 : 0.5,
          color: props.color,
          weight: props.isZero ? 2 : 1,
          opacity: 0.8,
        };
      }}
      onEachFeature={(feature, layer) => {
        const props = feature.properties as HexFeatureProperties;

        // Bind popup with hex cell data
        const popupContent = renderToStaticMarkup(<HexPopup hexCell={props.hexCell} />);
        layer.bindPopup(popupContent);
      }}
    />
  );
}
