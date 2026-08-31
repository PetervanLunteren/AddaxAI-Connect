/**
 * Shared base-layer control for every map in the app.
 *
 * Renders Leaflet's native in-map layers control (top-right) with Light /
 * Satellite / Street, and persists the choice to one shared localStorage key
 * so it carries across the sites map, cameras map, insights map and the site
 * location picker. Drop it inside any <MapContainer>; overlays (markers, hex
 * grids, legends) stay as normal MapContainer children and always show.
 *
 * Light is the OpenFreeMap Positron vector style, drawn by MapLibre GL. It
 * replaced the visually identical CARTO Positron raster tiles when CARTO
 * started watermarking keyless requests (August 2026). OpenFreeMap needs no
 * key and has no usage limits. MapLibre needs WebGL2, so devices without it
 * fall back to the Street raster tiles.
 */
import { lazy, Suspense } from 'react';
import { LayersControl, TileLayer, useMapEvents } from 'react-leaflet';

// Loaded only when a map actually renders, keeps maplibre-gl out of the
// main bundle.
const MapLibreGLLayer = lazy(() => import('./MapLibreGLLayer'));

const STORAGE_KEY = 'map-baselayer';

/**
 * Zoom limit for every map that uses these base layers. Set it on the
 * MapContainer, not only on a layer: Leaflet takes an unset map limit from
 * the layers that happen to be mounted, and the Light layer loads lazily.
 * A fitBounds on a single point in that window zooms to Infinity and
 * MapLibre crashes in its matrix math on init.
 */
export const MAP_MAX_ZOOM = 18;

const LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export const SATELLITE_LAYER = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution:
    'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
};

export const STREET_LAYER = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

// The 'positron' key predates the OpenFreeMap switch; it stays so stored
// preferences keep working.
const LAYERS = [
  { key: 'positron', name: 'Light' },
  { key: 'satellite', name: 'Satellite' },
  { key: 'osm', name: 'Street' },
];

let hasWebGL2: boolean | null = null;

function supportsWebGL2(): boolean {
  if (hasWebGL2 === null) {
    try {
      hasWebGL2 = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      hasWebGL2 = false;
    }
  }
  return hasWebGL2;
}

/**
 * The Light base layer on its own, for maps without a layer control
 * (dashboard mini map). Vector style when the device can draw it,
 * Street raster tiles when it cannot.
 */
export function LightBaseLayer() {
  if (!supportsWebGL2()) {
    return <TileLayer url={STREET_LAYER.url} attribution={STREET_LAYER.attribution} />;
  }
  return (
    <Suspense fallback={null}>
      <MapLibreGLLayer styleUrl={LIGHT_STYLE_URL} maxZoom={MAP_MAX_ZOOM} />
    </Suspense>
  );
}

function PersistBaseLayer() {
  useMapEvents({
    baselayerchange(e) {
      const match = LAYERS.find((l) => l.name === e.name);
      if (match) localStorage.setItem(STORAGE_KEY, match.key);
    },
  });
  return null;
}

export function BaseLayersControl() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const checkedKey = LAYERS.some((l) => l.key === stored) ? stored : 'positron';
  // The Light layer loads lazily and so registers with the control after the
  // raster layers. Sorting by our own order keeps the menu stable.
  const order = LAYERS.map((l) => l.name);
  return (
    <>
      <LayersControl
        position="topright"
        sortLayers
        sortFunction={(_a, _b, nameA, nameB) => order.indexOf(nameA) - order.indexOf(nameB)}
      >
        <LayersControl.BaseLayer name="Light" checked={checkedKey === 'positron'}>
          <LightBaseLayer />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite" checked={checkedKey === 'satellite'}>
          <TileLayer url={SATELLITE_LAYER.url} attribution={SATELLITE_LAYER.attribution} />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Street" checked={checkedKey === 'osm'}>
          <TileLayer url={STREET_LAYER.url} attribution={STREET_LAYER.attribution} />
        </LayersControl.BaseLayer>
      </LayersControl>
      <PersistBaseLayer />
    </>
  );
}
