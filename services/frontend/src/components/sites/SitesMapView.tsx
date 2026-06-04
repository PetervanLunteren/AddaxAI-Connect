/**
 * Sites map view.
 *
 * Plots each site as a marker. Mirrors the cameras map (same base layers,
 * fit-to-bounds, fullscreen control, marker style). Clicking a marker opens
 * the site detail panel. Sites are usually >100 m apart, but sub-100 m sites
 * exist (e.g. cameras on one pole), so overlapping pins spiderfy out like the
 * cameras map.
 */
import { useMemo, useEffect, useRef } from 'react';
import { MapContainer, Marker, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import L from 'leaflet';
import type { SiteListItem } from '../../api/sites';
import { FullscreenControl } from '../map/FullscreenControl';
import { BaseLayersControl } from '../map/BaseLayersControl';
import { SpiderLegLine } from '../map/SpiderLegLine';
import { useSpiderfied } from '../../hooks/useSpiderfied';
import 'leaflet/dist/leaflet.css';

// Primary teal, matching the design system.
const SITE_COLOR = '#0f6064';

interface SitesMapViewProps {
  sites: SiteListItem[];
  onSiteClick: (siteId: number) => void;
}

// Spreads overlapping site pins (sub-100 m sites) like the cameras map.
function SpiderfiedSiteLayer({
  sites,
  icon,
  onSiteClick,
}: {
  sites: SiteListItem[];
  icon: L.DivIcon;
  onSiteClick: (siteId: number) => void;
}) {
  const { spread, legs } = useSpiderfied(
    sites,
    (s) => (s.latitude != null && s.longitude != null ? { lat: s.latitude, lon: s.longitude } : null),
    (s) => s.id,
    { proximityThresholdPixels: 10, spreadRadiusPixels: 20 },
  );
  return (
    <>
      {legs.map((leg) => (
        <SpiderLegLine key={`leg-${leg.id}`} leg={leg} />
      ))}
      {spread.map(({ item, displayPosition }) => (
        <Marker
          key={item.id}
          position={[displayPosition.lat, displayPosition.lon]}
          icon={icon}
          eventHandlers={{ click: () => onSiteClick(item.id) }}
        >
          <Tooltip>{item.name}</Tooltip>
        </Marker>
      ))}
    </>
  );
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (points.length === 0 || fitted.current) return;
    map.fitBounds(latLngBounds(points), { padding: [30, 30] });
    fitted.current = true;
  }, [points, map]);
  return null;
}

export function SitesMapView({ sites, onSiteClick }: SitesMapViewProps) {
  const sitesWithLocation = useMemo(
    () => sites.filter((s) => s.latitude != null && s.longitude != null),
    [sites],
  );

  const points = useMemo<[number, number][]>(
    () => sitesWithLocation.map((s) => [s.latitude as number, s.longitude as number]),
    [sitesWithLocation],
  );

  const center = useMemo<[number, number]>(() => {
    if (points.length === 0) return [52.0, 5.0];
    const lat = points.reduce((a, p) => a + p[0], 0) / points.length;
    const lon = points.reduce((a, p) => a + p[1], 0) / points.length;
    return [lat, lon];
  }, [points]);

  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'site-marker-icon',
        html: `<div style="
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background-color: ${SITE_COLOR};
          border: 2px solid #555555;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    [],
  );

  if (sitesWithLocation.length === 0) {
    return (
      <div className="flex items-center justify-center h-[500px] bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-muted-foreground">No sites with location data to display.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <MapContainer
        center={center}
        zoom={12}
        style={{ height: '500px', width: '100%', zIndex: 0 }}
        className="rounded-lg border border-gray-200"
      >
        <BaseLayersControl />
        <FitBounds points={points} />
        <SpiderfiedSiteLayer
          sites={sitesWithLocation}
          icon={icon}
          onSiteClick={onSiteClick}
        />
        <FullscreenControl />
      </MapContainer>
    </div>
  );
}
