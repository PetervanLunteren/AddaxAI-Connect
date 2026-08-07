/**
 * Hexbin layer for detection rate map
 * Aggregates sites into hexagonal cells
 */
import { useMemo, useCallback } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { FeatureCollection, Polygon, Feature } from 'geojson';
import type { Layer } from 'leaflet';
import { featureCollection } from '@turf/helpers';
import type { SiteFeature } from '../../api/types';
import {
  generateHexGrid,
  aggregateSitesToHexes,
  type HexCell,
} from '../../utils/hex-grid';
import type { MapMetric } from '../../utils/map-metrics';
import { getDetectionRateColor } from '../../utils/color-scale';
import { renderToStaticMarkup } from 'react-dom/server';
import { HexPopup } from './HexPopup';

interface HexbinLayerProps {
  sites: SiteFeature[];
  zoomLevel: number;
  mapBounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  metric: MapMetric;
  domainMax: number; // For color scale normalization
}

// Store hex cell data in feature properties for popup access
interface HexFeatureProperties {
  hexCell: HexCell;
  value: number;
  color: string;
  isZero: boolean;
}

export function HexbinLayer({ sites, zoomLevel, mapBounds, metric, domainMax }: HexbinLayerProps) {
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

  // Create GeoJSON FeatureCollection with all hexagons. The cell value comes
  // from the metric's own aggregation (union for richness, pooled counts for
  // Shannon, sums otherwise), not from a mean of per-site numbers.
  const hexFeatureCollection = useMemo<FeatureCollection<Polygon, HexFeatureProperties>>(() => {
    const features = hexCells.map((hexCell) => {
      const members = hexCell.sites.map((s) => s.properties);
      const value = metric.aggregate(members);
      const isZero = members.every((p) => metric.isEmpty(p));
      const color = getDetectionRateColor(value, domainMax);

      return {
        ...hexCell.hex,
        properties: {
          hexCell,
          value,
          color,
          isZero,
        },
      };
    });

    return featureCollection(features) as FeatureCollection<Polygon, HexFeatureProperties>;
  }, [hexCells, metric, domainMax]);

  // Stable style function using useCallback
  // Leaflet types the style callback as receiving any Feature, so the
  // parameter stays generic and the properties are narrowed below.
  const styleFunction = useCallback((feature?: Feature) => {
    const props = feature?.properties as HexFeatureProperties | undefined;
    if (!props) return {};

    // Hollow hex for cells with no data for this metric. They are real data
    // (cameras deployed, nothing seen) and should stay distinguishable from
    // the low end of the colour gradient.
    return {
      fillColor: props.color,
      fillOpacity: props.isZero ? 0 : 0.8,
      color: '#555555', // Dark grey border
      weight: 1,
      opacity: 0.8,
    };
  }, []); // No dependencies - uses data from feature properties

  // Popup content depends on the metric, so the handler must rebuild when it
  // changes (the GeoJSON key below forces a remount on metric switch).
  const onEachFeatureHandler = useCallback((feature: Feature<Polygon, HexFeatureProperties>, layer: Layer) => {
    const props = feature.properties as HexFeatureProperties;
    // Show popup for all hexagons (including zeros - they still have useful info)
    const popupContent = renderToStaticMarkup(
      <HexPopup hexCell={props.hexCell} metric={metric} value={props.value} />
    );
    layer.bindPopup(popupContent);
  }, [metric]);

  if (hexCells.length === 0) {
    return null;
  }

  return (
    <GeoJSON
      key={`hexbin-${zoomLevel}-${hexCells.length}-${metric.id}`}
      data={hexFeatureCollection}
      style={styleFunction}
      onEachFeature={onEachFeatureHandler}
    />
  );
}
