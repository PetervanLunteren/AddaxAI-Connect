/**
 * The map of the camera updates check, on satellite: the landscape shows
 * whether a move is real.
 *
 * It shows every site of the project in teal, the ones outside the current
 * update faded, and the move as an arrow. A click on a site is passed up
 * (it picks the site for Set site). In pick mode a click on an empty spot
 * is passed up too, to make a new site there.
 *
 * Everything of the camera itself is magenta, which stands out on forest,
 * heath and sand alike: the arrow, the GPS of its photos (this deployment
 * strong, its others faded) and the ring of the move rule around the
 * deployment. The site marker is the place, so the deployment gets no pin
 * of its own. The map fits to the camera's dots each time the selection
 * changes. A small legend names the four things.
 */
import { Fragment, useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L, { latLng, latLngBounds, type LatLngBounds } from 'leaflet';
import type { CameraReadings, DeploymentListItem } from '../../api/deployments';
import { BaseLayersControl, MapAttribution, MAP_MAX_ZOOM } from '../map/BaseLayersControl';
import { FullscreenControl } from '../map/FullscreenControl';
import { SITE_COLOR, SiteMarkersLayer, type SitePin } from '../sites/SiteMarkersLayer';
import { metresLabel } from './update-items';
import 'leaflet/dist/leaflet.css';

const CAMERA = '#e6007e'; // magenta

/** A move drawn as an arrow from the old site to the new one. */
export interface MapArrow {
  key: string;
  from: [number, number];
  to: [number, number];
  label: string;
}

interface Props {
  sites: SitePin[];
  // Sites outside this set are drawn faded. Null = none faded.
  activeSiteIds?: Set<number> | null;
  arrows?: MapArrow[];
  selected: DeploymentListItem | null;
  readings: CameraReadings | undefined;
  onSiteClick: (siteId: number) => void;
  // Pick mode: a click on an empty spot gives its coordinates.
  onSpotClick?: (lat: number, lon: number) => void;
  height: number | string; // px, or a CSS length such as min(65vh, 640px)
}

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

/**
 * Fit the map when the selection changes: to all the selected camera's dots
 * and the ring around its pin, so the earlier place of a move is in view,
 * or back to everything in view when the selection is cleared. Waits until
 * the bounds are known (the GPS arrives a moment later). A user who zooms
 * afterwards is not thrown back.
 */
function FitOnSelection({ selectionKey, bounds }: { selectionKey: number | null; bounds: LatLngBounds | null }) {
  const map = useMap();
  const ready = bounds !== null;
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, ready, map]);
  return null;
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

/** The four things on the map, bottom left above the attribution. */
function Legend({ thresholdM }: { thresholdM: number | undefined }) {
  const row = 'flex items-center gap-2';
  return (
    <div className="absolute left-2 bottom-7 z-[400] rounded-md bg-background/90 px-2 py-1.5 text-xs shadow space-y-1 pointer-events-none">
      <div className={row}>
        <span className="inline-block h-3 w-3 rounded-full border-2 border-[#555555]" style={{ backgroundColor: SITE_COLOR }} />
        Site
      </div>
      <div className={row}>
        <span className="inline-block h-2 w-2 mx-0.5 rounded-full" style={{ backgroundColor: CAMERA }} />
        Photo GPS
      </div>
      <div className={row}>
        <span className="inline-block h-3 w-3 rounded-full border border-dashed" style={{ borderColor: CAMERA }} />
        GPS noise{thresholdM !== undefined && `, ${metresLabel(thresholdM)}`}
      </div>
      <div className={row}>
        <span className="inline-block h-0.5 w-3" style={{ backgroundColor: CAMERA }} />
        Move
      </div>
    </div>
  );
}

export function DeploymentsMap({
  sites, activeSiteIds = null, arrows = [], selected, readings, onSiteClick, onSpotClick, height,
}: Props) {
  const placed = useMemo(() => sites.filter((s) => s.latitude != null && s.longitude != null), [sites]);
  const sitePoints = useMemo<[number, number][]>(
    () => placed.map((s) => [s.latitude as number, s.longitude as number]),
    [placed],
  );
  const dots = selected && readings ? readings.dots : [];
  const dotPoints = useMemo<[number, number][]>(() => dots.map((d) => [d.latitude, d.longitude]), [dots]);
  // Strong dots last, so they draw on top.
  const ordered = useMemo(
    () => [...dots].sort((a, b) => Number(a.deployment_id === selected?.id) - Number(b.deployment_id === selected?.id)),
    [dots, selected?.id],
  );

  if (placed.length === 0 && !selected) {
    return (
      <div className="flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200" style={{ height }}>
        <p className="text-sm text-muted-foreground">No sites with a location to show.</p>
      </div>
    );
  }

  const pin: [number, number] | null =
    selected && selected.latitude != null && selected.longitude != null ? [selected.latitude, selected.longitude] : null;
  let fitBounds: LatLngBounds | null = null;
  if (selected && readings) {
    fitBounds = pin ? latLng(pin).toBounds(readings.threshold_m * 2) : null;
    if (dotPoints.length) fitBounds = fitBounds ? fitBounds.extend(latLngBounds(dotPoints)) : latLngBounds(dotPoints);
  } else if (!selected) {
    const inView: [number, number][] = [
      ...placed.filter((p) => activeSiteIds === null || activeSiteIds.has(p.id))
        .map((p) => [p.latitude as number, p.longitude as number] as [number, number]),
      ...arrows.flatMap((a) => [a.from, a.to]),
    ];
    fitBounds = inView.length ? latLngBounds(inView) : null;
  }

  return (
    <MapContainer
      center={sitePoints[0] ?? pin ?? [52.0, 5.0]}
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
        isFaded={(s) => (selected !== null ? s.id !== selected.site_id : activeSiteIds !== null && !activeSiteIds.has(s.id))}
      />
      {arrows.map((a) => (
        <Fragment key={a.key}>
          <Polyline positions={[along(a, ARROW_FROM), along(a, ARROW_TO)]} pathOptions={{ color: CAMERA, weight: 4, opacity: 0.95 }}>
            <Tooltip sticky>{a.label}</Tooltip>
          </Polyline>
          <Marker
            position={along(a, ARROW_TO)}
            icon={arrowHead(bearing(a.from, a.to), CAMERA)}
            interactive={false}
          />
        </Fragment>
      ))}
      {ordered.map((d) => {
        const strong = d.deployment_id === selected?.id;
        return (
          <CircleMarker
            key={`${d.deployment_id}-${d.latitude}-${d.longitude}`}
            center={[d.latitude, d.longitude]}
            radius={4}
            pathOptions={{
              color: '#ffffff',
              weight: 1,
              fillColor: CAMERA,
              fillOpacity: strong ? 0.85 : 0.3,
              opacity: strong ? 0.9 : 0.3,
            }}
          >
            <Tooltip>
              {d.count.toLocaleString()} photo{d.count === 1 ? '' : 's'}
              {strong ? '' : ', another deployment'}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {pin && readings && (
        <Circle
          center={pin}
          radius={readings.threshold_m}
          interactive={false}
          pathOptions={{ color: CAMERA, weight: 1.5, dashArray: '6 4', fill: false }}
        />
      )}
      <FitOnSelection selectionKey={selected?.id ?? null} bounds={fitBounds} />
      {onSpotClick && <SpotClicks onSpotClick={onSpotClick} />}
      <FullscreenControl />
      <Legend thresholdM={readings?.threshold_m} />
    </MapContainer>
  );
}
