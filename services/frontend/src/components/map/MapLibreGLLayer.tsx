/**
 * MapLibre GL vector base layer as a react-leaflet layer.
 *
 * Renders a vector style (OpenFreeMap Positron) through MapLibre GL inside a
 * normal Leaflet map, via @maplibre/maplibre-gl-leaflet. Everything else on
 * the map (markers, clustering, controls, overlays) stays plain Leaflet.
 *
 * This module pulls in maplibre-gl (~250 KB gzip), so it is only ever loaded
 * through React.lazy in BaseLayersControl. Do not import it statically.
 *
 * maxZoom matters: Leaflet takes the map's zoom range from the layers on it,
 * and leaflet.markercluster throws "Map has no maxZoom specified" when the
 * range is unbounded. Raster tile layers carry a default of 18; this layer
 * must declare one itself. The vector data stops at z14 and MapLibre
 * overzooms it, so rendering stays crisp all the way down.
 *
 * Attribution is ours, never the style's. The plugin turns MapLibre's own
 * attribution control off and hands the string to Leaflet's control instead,
 * which writes it straight into innerHTML and sanitises nothing. Reading that
 * string from the style server would let whoever serves the tiles run script
 * in every user's browser. customAttribution makes the plugin return the
 * string below rather than the one it fetched, so the remote value never
 * reaches the DOM. Street and Satellite hardcode theirs the same way, in
 * BaseLayersControl.
 */
import {
  createElementObject,
  createLayerComponent,
  type LayerProps,
} from '@react-leaflet/core';
import { MaplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapLibreGLLayerProps extends LayerProps {
  /** URL of the MapLibre style JSON. */
  styleUrl: string;
  /** Leaflet zoom limit, same default as a raster TileLayer. */
  maxZoom?: number;
  /** Credit line to show. Required, so it can never fall back to the style's. */
  attribution: string;
}

const MapLibreGLLayer = createLayerComponent<
  InstanceType<typeof MaplibreGL>,
  MapLibreGLLayerProps
>(({ styleUrl, maxZoom = 18, attribution }, ctx) => {
  const layer = new MaplibreGL({
    style: styleUrl,
    maxZoom,
    attributionControl: { customAttribution: attribution },
  });
  return createElementObject(layer, ctx);
});

export default MapLibreGLLayer;
