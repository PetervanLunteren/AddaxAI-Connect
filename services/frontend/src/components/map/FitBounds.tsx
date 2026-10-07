/**
 * Fit the map to a set of points once, on first render with data. Later
 * changes to the points do not refit, so a user who panned or zoomed is not
 * thrown back.
 *
 * The fit jumps instead of animating. The map mounts at a placeholder zoom,
 * and for points a few hundred metres apart the animation spans six or more
 * zoom levels, drawing the markers huge on the way: a swoop on every open
 * that says nothing.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';

export function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (points.length === 0 || fitted.current) return;
    map.fitBounds(latLngBounds(points), { padding: [30, 30], animate: false });
    fitted.current = true;
  }, [points, map]);
  return null;
}
