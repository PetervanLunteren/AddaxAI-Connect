/**
 * How a point looks on every map, so it reads on any background: a light
 * map, a street map, and satellite imagery of dark forest or pale sand.
 *
 * A white ring around a coloured dot, with a soft shadow, as Google, Apple
 * and OpenStreetMap markers do. The old dark grey ring vanished into dark
 * imagery. One part for every map (Sites, site pickers, merge, the moves
 * check, Insights points, hexagons and clusters), where it used to be built
 * four times.
 *
 * Colours with one meaning each, on every map:
 * - SITE_COLOR, brand teal: a site.
 * - FOCUS_COLOR, magenta: what you are looking at or choosing (the move in
 *   the check, the spot picked for a site, sites selected, the site a merge
 *   keeps). Almost nothing in nature is magenta, so it stands out on forest,
 *   heath and sand alike.
 * - ALERT_COLOR, a bright red: something wrong (an inactive camera, low
 *   battery or signal, the site a merge removes). Bright on purpose: the old
 *   dark red sank into dark imagery.
 */
import L from 'leaflet';

export const SITE_COLOR = '#0f6064';
export const FOCUS_COLOR = '#e6007e';
export const ALERT_COLOR = '#d62828';

/** The ring of every point: white, and its width in px. */
export const MARKER_RING = '#ffffff';
export const MARKER_RING_WIDTH = 2;

/** The style of a dot of `size` px, as a React style object (legend
 *  swatches in JSX). dotStyle gives the same as a CSS string. */
export function dotCss(color: string, size = 16, faded = false) {
  return {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    backgroundColor: color,
    border: `${MARKER_RING_WIDTH}px solid ${MARKER_RING}`,
    boxShadow: '0 0 0 1px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.4)',
    boxSizing: 'border-box' as const,
    opacity: faded ? 0.4 : 1,
  };
}

/** The same dot as a CSS string, for divIcons and legends built as HTML. */
export function dotStyle(color: string, size = 16, faded = false): string {
  return Object.entries(dotCss(color, size, faded))
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${v}`)
    .join('; ');
}

const iconCache = new Map<string, L.DivIcon>();

/** A dot as a Leaflet icon, anchored at its centre. Cached per look. */
export function dotIcon(color: string, size = 16, faded = false): L.DivIcon {
  const key = `${color}-${size}-${faded}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: 'site-marker-icon',
      html: `<div style="${dotStyle(color, size, faded)}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

/**
 * Path options for a CircleMarker or polygon in the same style. The class
 * gives the white ring a thin dark shadow (styles/index.css), so a hollow
 * marker, which is only its ring, still shows on a light map.
 */
export function ringPath(fillColor: string, fillOpacity = 1, weight = MARKER_RING_WIDTH) {
  return { color: MARKER_RING, weight, opacity: 1, fillColor, fillOpacity, className: 'map-ring' };
}
