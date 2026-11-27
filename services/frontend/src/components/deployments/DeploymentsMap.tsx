/**
 * The map of a deployment's panel, on satellite: the landscape shows
 * whether a move is real.
 *
 * It shows the moves and nothing more: the site the camera came from, the
 * site of the deployment and the site it went to, all magenta like the
 * arrows between them, and the project's other sites faded teal. A
 * deployment that did not move has its one site magenta. A person decides a
 * move by whether they moved the camera, and the two photos in the panel
 * show that, so the GPS of the photos is not drawn. The GPS stays the input
 * of the build.
 *
 * Nothing on it is clickable. The map fits to the moves once; the panel
 * mounts a new map per deployment.
 */
import { Fragment, useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { BaseLayersControl, MapAttribution, MAP_MAX_ZOOM } from '../map/BaseLayersControl';
import { FitBounds } from '../map/FitBounds';
import { FullscreenControl } from '../map/FullscreenControl';
import { FOCUS_COLOR, SITE_COLOR } from '../map/marker-style';
import { SiteMarkersLayer, type SitePin } from '../sites/SiteMarkersLayer';
import 'leaflet/dist/leaflet.css';

// The move is the focus colour shared by every map (marker-style.ts).
const MOVE = FOCUS_COLOR;

/** A move drawn as an arrow from the old site to the new one. */
export interface MapArrow {
  key: string;
  from: [number, number];
  to: [number, number];
  label: string;
}

interface Props {
  sites: SitePin[];
  // The sites to draw magenta. Null = none: every site plain.
  activeSiteIds: Set<number> | null;
  arrows: MapArrow[];
  height: number | string; // px, or a CSS length such as 100% of its box
}

// The arrow runs from 15% to 85% of the way, as in flow maps: it never
// covers the two site markers, and the head sits at the end of the line.
// Proportional, so a 300 m move and a 3 km move look alike.
const ARROW_FROM = 0.15;
const ARROW_TO = 0.85;
// Every arrow leans to the right of its direction by this part of its
// length, so a trip there and back draws two curves and not one line twice.
const BEND = 0.15;
const CURVE_STEPS = 12;

/**
 * The point at part `t` of the arrow's curve: a quadratic curve whose
 * middle is pushed sideways. Longitude is scaled to the latitude, so the
 * push is square to the line on the map.
 */
function along(a: MapArrow, t: number): [number, number] {
  const scale = Math.cos(((a.from[0] + a.to[0]) / 2) * (Math.PI / 180)) || 1;
  const dLat = a.to[0] - a.from[0];
  const dLon = (a.to[1] - a.from[1]) * scale;
  // The control point: the middle, moved to the right by BEND (the curve
  // itself reaches half of that).
  const cLat = dLat / 2 - dLon * BEND * 2;
  const cLon = dLon / 2 + dLat * BEND * 2;
  const u = 1 - t;
  return [
    a.from[0] + 2 * u * t * cLat + t * t * dLat,
    a.from[1] + (2 * u * t * cLon + t * t * dLon) / scale,
  ];
}

/** The curve as points, from ARROW_FROM to ARROW_TO. */
const curve = (a: MapArrow): [number, number][] =>
  Array.from({ length: CURVE_STEPS + 1 }, (_, i) =>
    along(a, ARROW_FROM + ((ARROW_TO - ARROW_FROM) * i) / CURVE_STEPS));

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

/**
 * Redraw the map whenever its box changes size. Leaflet measures its box
 * once; when the box changes later (fullscreen, a resized window) the new
 * part stays grey.
 */
function FollowSize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export function DeploymentsMap({ sites, activeSiteIds, arrows, height }: Props) {
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
        onSiteClick={() => {}}
        colorFor={(s) => (inMove(s) ? MOVE : SITE_COLOR)}
        isFaded={(s) => activeSiteIds !== null && !inMove(s)}
      />
      {arrows.map((a) => {
        const line = curve(a);
        const end = line[line.length - 1];
        return (
          <Fragment key={a.key}>
            <Polyline positions={line} pathOptions={{ color: MOVE, weight: 4, opacity: 0.95 }}>
              <Tooltip sticky>{a.label}</Tooltip>
            </Polyline>
            {/* The head points the way the last piece of the curve runs. */}
            <Marker position={end} icon={arrowHead(bearing(line[line.length - 2], end), MOVE)} interactive={false} />
          </Fragment>
        );
      })}
      <FitBounds points={fitPoints} maxZoom={16} />
      <FullscreenControl />
      <FollowSize />
    </MapContainer>
  );
}
