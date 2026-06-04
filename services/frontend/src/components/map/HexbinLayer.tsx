/**
 * Hexbin layer for detection rate map
 * Aggregates sites into hexagonal cells
 */
import { useMemo, useCallback } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { FeatureCollection, Polygon, Feature } from 'geojson';
import type { Layer, PathOptions } from 'leaflet';
import { featureCollection } from '@turf/helpers';
import type { SiteFeature } from '../../api/types';
import {
  generateHexGrid,
  aggregateSitesToHexes,
  type HexCell,
} from '../../utils/hex-grid';
import { getDetectionRateColor } from '../../utils/color-scale';
import { renderToStaticMarkup } from 'react-dom/server';
import { HexPopup } from './HexPopup';

interface HexbinLayerProps {
  sites: SiteFeature[];
  zoomLevel: number;
  mapBounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  maxDetectionRate?: number; // For color scale normalization
}

// Store hex cell data in feature properties for popup access
interface HexFeatureProperties {
  hexCell: HexCell;
  color: string;
  isZero: boolean;
}

export function HexbinLayer({ sites, zoomLevel, mapBounds, maxDetectionRate }: HexbinLayerProps) {
  // Generate hex grid and aggregate sites
  const hexCells = useMemo(() => {
    if (sites.length === 0) {
      return [];
    }

    // Use map viewport bounds for consistent zoom-based sizing.
    const hexGrid = generateHexGrid(mapBounds, zoomLevel);
    const cells = aggregateSitesToHexes(sites, hexGrid);

    return cells;
  }, [sites, zoomLevel, mapBounds]);

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

    // Hollow hex for zero-detection cells. They are real data (cameras
    // deployed, nothing seen) and should stay distinguishable from the
    // low end of the colour gradient.
    return {
      fillColor: props.color,
      fillOpacity: props.isZero ? 0 : 0.8,
      color: '#555555', // Dark grey border
      weight: 1,
      opacity: 0.8,
    };
  }, []); // No dependencies - uses data from feature properties

  // Stable onEachFeature function using useCallback
  const onEachFeatureHandler = useCallback((feature: Feature<Polygon, HexFeatureProperties>, layer: Layer) => {
    const props = feature.properties as HexFeatureProperties;
    // Show popup for all hexagons (including zeros - they still have useful info)
    const popupContent = renderToStaticMarkup(<HexPopup hexCell={props.hexCell} />);
    layer.bindPopup(popupContent);
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
