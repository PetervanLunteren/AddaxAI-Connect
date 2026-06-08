/**
 * Site location picker.
 *
 * Click the map to set a coordinate; an existing-sites layer shows context.
 * Mirrors the AddaxAI-WebUI add-site map UX, built on react-leaflet to match
 * the rest of this app (SitesMapView). The parent owns the
 * lat/lon value and keeps manual number inputs in sync, so typing and clicking
 * both drive the same marker.
 */
import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import L from 'leaflet';
import type { SiteListItem } from '../../api/sites';
import { BaseLayersControl } from '../map/BaseLayersControl';
import 'leaflet/dist/leaflet.css';

const SELECTED_COLOR = '#882000'; // destructive-ish, stands out from existing sites
const SITE_COLOR = '#0f6064'; // primary teal, matches SitesMapView

interface Props {
  value: { lat: number; lon: number } | null;
  onChange: (lat: number, lon: number) => void;
  sites: SiteListItem[];
  excludeSiteId?: number;
  height?: number;
}

function markerIcon(color: string, size: number) {
  return L.divIcon({
    className: 'site-picker-marker',
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      background-color: ${color}; border: 2px solid #555555;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ClickToSet({ onChange }: { onChange: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Center the map on the data. The data (the selected value and/or existing
// sites) often arrives AFTER mount (the site detail is still fetching when the
// slideout opens), and MapContainer's `center` prop is initial-only, so we
// drive the view imperatively here.
function AutoCenter({
  value,
  points,
}: {
  value: { lat: number; lon: number } | null;
  points: [number, number][];
}) {
  const map = useMap();
  const fitted = useRef(false);

  // Fit to all points the first time they are available.
  useEffect(() => {
    if (fitted.current || points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(latLngBounds(points), { padding: [30, 30] });
    }
    fitted.current = true;
  }, [points, map]);

  // After the initial fit, keep the selected marker visible if it moves
  // off-screen (e.g. the slideout reuses this map instance for another site).
  // A marker already in view is left alone, so typing/clicking does not jump.
  useEffect(() => {
    if (!value) return;
    if (!map.getBounds().contains([value.lat, value.lon])) {
      map.setView([value.lat, value.lon], Math.max(map.getZoom(), 13));
    }
  }, [value?.lat, value?.lon, map]);

  return null;
}

export function SiteLocationPicker({ value, onChange, sites, excludeSiteId, height = 320 }: Props) {
  const existing = useMemo(
    () =>
      sites.filter(
        (s) => s.id !== excludeSiteId && s.latitude != null && s.longitude != null,
      ),
    [sites, excludeSiteId],
  );

  const points = useMemo<[number, number][]>(() => {
    const pts = existing.map((s) => [s.latitude as number, s.longitude as number] as [number, number]);
    if (value) pts.push([value.lat, value.lon]);
    return pts;
  }, [existing, value]);

  const center = useMemo<[number, number]>(() => {
    if (value) return [value.lat, value.lon];
    if (points.length > 0) return points[0];
    return [52.0, 5.0];
  }, [value, points]);

  const selectedIcon = useMemo(() => markerIcon(SELECTED_COLOR, 18), []);
  const siteIcon = useMemo(() => markerIcon(SITE_COLOR, 14), []);

  return (
    <div className="rounded-md border overflow-hidden" style={{ height }}>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%', zIndex: 0 }}
      >
        <BaseLayersControl />
        <ClickToSet onChange={onChange} />
        <AutoCenter value={value} points={points} />
        {existing.map((s) => (
          <Marker
            key={s.id}
            position={[s.latitude as number, s.longitude as number]}
            icon={siteIcon}
          >
            <Tooltip>{s.name}</Tooltip>
          </Marker>
        ))}
        {value && (
          <Marker
            position={[value.lat, value.lon]}
            icon={selectedIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = e.target.getLatLng();
                onChange(p.lat, p.lng);
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
