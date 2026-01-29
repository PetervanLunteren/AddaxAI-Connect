/**
 * Hexbin layer for detection rate map
 * Aggregates camera deployments into hexagonal cells
 */
import { useMemo } from 'react';
import { GeoJSON, Popup, useMap } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import type { DeploymentFeature } from '../../api/types';
import {
  generateHexGrid,
  aggregateDeploymentsToHexes,
  getDeploymentsBounds,
  type HexCell,
} from '../../utils/hex-grid';
import { getDetectionRateColor } from '../../utils/color-scale';
import { HexPopup } from './HexPopup';

interface HexbinLayerProps {
  deployments: DeploymentFeature[];
  zoomLevel: number;
  maxDetectionRate?: number; // For color scale normalization
}

export function HexbinLayer({ deployments, zoomLevel, maxDetectionRate }: HexbinLayerProps) {
  const map = useMap();

  // Generate hex grid and aggregate deployments
  const hexCells = useMemo(() => {
    if (deployments.length === 0) {
      return [];
    }

    // Use map bounds if available, otherwise deployment bounds
    let bounds;
    try {
      const mapBounds = map.getBounds();
      bounds = [
        mapBounds.getWest(),
        mapBounds.getSouth(),
        mapBounds.getEast(),
        mapBounds.getNorth(),
      ] as [number, number, number, number];
    } catch {
      // Fallback to deployment bounds if map not ready
      bounds = getDeploymentsBounds(deployments) as [number, number, number, number];
    }

    const hexGrid = generateHexGrid(bounds, zoomLevel);
    return aggregateDeploymentsToHexes(deployments, hexGrid);
  }, [deployments, zoomLevel, map]);

  // Calculate max detection rate for color scale if not provided
  const maxRate = useMemo(() => {
    if (maxDetectionRate !== undefined) return maxDetectionRate;
    if (hexCells.length === 0) return 0;
    return Math.max(...hexCells.map((cell) => cell.detection_rate_per_100));
  }, [hexCells, maxDetectionRate]);

  // Style function for hexagons
  const getHexStyle = (hexCell: HexCell): PathOptions => {
    const isZero = hexCell.detection_count === 0;
    const color = getDetectionRateColor(hexCell.detection_rate_per_100, maxRate);

    return {
      fillColor: color,
      fillOpacity: isZero ? 0.2 : 0.5,
      color: color,
      weight: isZero ? 2 : 1,
      opacity: 0.8,
    };
  };

  if (hexCells.length === 0) {
    return null;
  }

  return (
    <>
      {hexCells.map((hexCell, index) => {
        const hexFeature = hexCell.hex;
        const style = getHexStyle(hexCell);

        return (
          <GeoJSON
            key={`hex-${index}`}
            data={hexFeature}
            pathOptions={style}
            eventHandlers={{
              mouseover: (e) => {
                const layer = e.target;
                layer.setStyle({
                  weight: 3,
                  fillOpacity: hexCell.detection_count === 0 ? 0.4 : 0.7,
                });
              },
              mouseout: (e) => {
                const layer = e.target;
                layer.setStyle(style);
              },
            }}
          >
            <Popup>
              <HexPopup hexCell={hexCell} />
            </Popup>
          </GeoJSON>
        );
      })}
    </>
  );
}
