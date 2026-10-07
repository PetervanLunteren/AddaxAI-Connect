/**
 * Fit the map to a set of points once, on first render with data. Later
 * changes to the points do not refit, so a user who panned or zoomed is not
 * thrown back.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';

export function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (points.length === 0 || fitted.current) return;
    map.fitBounds(latLngBounds(points), { padding: [30, 30] });
    fitted.current = true;
  }, [points, map]);
  return null;
}
