/**
 * Shared base-layer control for every map in the app.
 *
 * Renders Leaflet's native in-map layers control (top-right) with Light /
 * Satellite / Street, and persists the choice to one shared localStorage key
 * so it carries across the sites map, cameras map, insights map and the site
 * location picker. Drop it inside any <MapContainer>; overlays (markers, hex
 * grids, legends) stay as normal MapContainer children and always show.
 */
import { LayersControl, TileLayer, useMapEvents } from 'react-leaflet';

const STORAGE_KEY = 'map-baselayer';

export const BASE_LAYERS = [
  {
    key: 'positron',
    name: 'Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    key: 'satellite',
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  },
  {
    key: 'osm',
    name: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
];

function PersistBaseLayer() {
  useMapEvents({
    baselayerchange(e) {
      const match = BASE_LAYERS.find((l) => l.name === e.name);
      if (match) localStorage.setItem(STORAGE_KEY, match.key);
    },
  });
  return null;
}

export function BaseLayersControl() {
  const stored = localStorage.getItem(STORAGE_KEY);
  const checkedKey = BASE_LAYERS.some((l) => l.key === stored) ? stored : 'positron';
  return (
    <>
      <LayersControl position="topright">
        {BASE_LAYERS.map((l) => (
          <LayersControl.BaseLayer key={l.key} name={l.name} checked={l.key === checkedKey}>
            <TileLayer url={l.url} attribution={l.attribution} />
          </LayersControl.BaseLayer>
        ))}
      </LayersControl>
      <PersistBaseLayer />
    </>
  );
}
