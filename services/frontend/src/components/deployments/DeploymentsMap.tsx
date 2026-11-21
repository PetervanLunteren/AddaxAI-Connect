/**
 * The map of the moves check, on satellite: the landscape shows
 * whether a move is real.
 *
 * It shows the move and nothing more: the site it left and the site it went
 * to, both magenta like the arrow between them, and the project's other
 * sites faded teal. A correction has no move: its one site is magenta. A person decides a move by whether they moved the
 * camera, and the two photos in the card show that, so the GPS of the
 * photos is not drawn. The GPS stays the input of the build.
 *
 * A click on a site is passed up (it picks the site for Set site). In pick
 * mode a click on an empty spot is passed up too, to make a new site there.
 * The map fits to the move once; the check mounts a new map per update.
 */
import { Fragment, useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { BaseLayersControl, MapAttribution, MAP_MAX_ZOOM } from '../map/BaseLayersControl';
import { FitBounds } from '../map/FitBounds';
import { FullscreenControl } from '../map/FullscreenControl';
import { SITE_COLOR, SiteMarkersLayer, type SitePin } from '../sites/SiteMarkersLayer';
import 'leaflet/dist/leaflet.css';

const MOVE = '#e6007e'; // magenta, stands out on forest, heath and sand alike

/** A move drawn as an arrow from the old site to the new one. */
export interface MapArrow {
  key: string;
  from: [number, number];
  to: [number, number];
  label: string;
}

interface Props {
  sites: SitePin[];
  // The sites of the move, drawn magenta. Null = no move: every site plain.
  activeSiteIds: Set<number> | null;
  arrows: MapArrow[];
  onSiteClick: (siteId: number) => void;
  // Pick mode: a click on an empty spot gives its coordinates.
  onSpotClick?: (lat: number, lon: number) => void;
  height: number | string; // px, or a CSS length such as min(65vh, 640px)
}

// The arrow runs from 15% to 85% of the way, as in flow maps: it never
// covers the two site markers, and the head sits at the end of the line.
// Proportional, so a 300 m move and a 3 km move look alike.
const ARROW_FROM = 0.15;
const ARROW_TO = 0.85;

const along = (a: MapArrow, t: number): [number, number] => [
  a.from[0] + (a.to[0] - a.from[0]) * t,
  a.from[1] + (a.to[1] - a.from[1]) * t,
];

const headCache = new Map<string, L.DivIcon>();
/** An arrow head that points along the compass bearing, in degrees. */
function arrowHead(bearing: number, color: string): L.DivIcon {
  const key = `${Math.round(bearing)}-${color}`;
  let icon = headCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;
        border-bottom:14px solid ${color};transform:rotate(${bearing}deg);transform-origin:7px 7px"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    headCache.set(key, icon);
  }
  return icon;
}

function bearing([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return (Math.atan2(dx, lat2 - lat1) * 180) / Math.PI;
}

function SpotClicks({ onSpotClick }: { onSpotClick: (lat: number, lon: number) => void }) {
  const map = useMapEvents({ click: (e) => onSpotClick(e.latlng.lat, e.latlng.lng) });
  useEffect(() => {
    map.getContainer().style.cursor = 'crosshair';
    return () => { map.getContainer().style.cursor = ''; };
  }, [map]);
  return null;
}

export function DeploymentsMap({ sites, activeSiteIds, arrows, onSiteClick, onSpotClick, height }: Props) {
  const placed = useMemo(() => sites.filter((s) => s.latitude != null && s.longitude != null), [sites]);
  // Fit to the move, else to the sites in it, else to every site.
  const fitPoints = useMemo<[number, number][]>(() => {
    if (arrows.length > 0) return arrows.flatMap((a) => [a.from, a.to]);
    const inView = activeSiteIds ? placed.filter((s) => activeSiteIds.has(s.id)) : [];
    return (inView.length > 0 ? inView : placed).map((s) => [s.latitude as number, s.longitude as number]);
  }, [arrows, placed, activeSiteIds]);

  if (placed.length === 0) {
    return (
      <div className="flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200" style={{ height }}>
        <p className="text-sm text-muted-foreground">No sites with a location to show.</p>
      </div>
    );
  }

  const inMove = (s: SitePin) => activeSiteIds !== null && activeSiteIds.has(s.id);
  return (
    <MapContainer
      center={fitPoints[0] ?? [52.0, 5.0]}
      zoom={12}
      maxZoom={MAP_MAX_ZOOM}
      style={{ height, width: '100%', zIndex: 0 }}
      attributionControl={false}
      className="rounded-lg border border-gray-200"
    >
      <MapAttribution />
      <BaseLayersControl initial="satellite" />
      <SiteMarkersLayer
        sites={placed}
        onSiteClick={onSiteClick}
        colorFor={(s) => (inMove(s) ? MOVE : SITE_COLOR)}
        isFaded={(s) => activeSiteIds !== null && !inMove(s)}
      />
      {arrows.map((a) => (
        <Fragment key={a.key}>
          <Polyline positions={[along(a, ARROW_FROM), along(a, ARROW_TO)]} pathOptions={{ color: MOVE, weight: 4, opacity: 0.95 }}>
            <Tooltip sticky>{a.label}</Tooltip>
          </Polyline>
          <Marker position={along(a, ARROW_TO)} icon={arrowHead(bearing(a.from, a.to), MOVE)} interactive={false} />
        </Fragment>
      ))}
      <FitBounds points={fitPoints} maxZoom={16} />
      {onSpotClick && <SpotClicks onSpotClick={onSpotClick} />}
      <FullscreenControl />
    </MapContainer>
  );
}
