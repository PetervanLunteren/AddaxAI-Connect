/**
 * The map of the camera updates check.
 *
 * It shows every site of the project, the ones outside the current view
 * faded, and the moves of the updates list as arrows. A click on a site is
 * passed up (it filters, or picks the site for Change site). In pick mode a
 * click on an empty spot is passed up too, to make a new site there.
 *
 * With a deployment selected it also shows
 * where the photos of that camera were taken: the dots of the selected
 * deployment strong, the camera's other dots faded, the pin of the
 * deployment and the ring of the move rule around it. The map fits to the
 * camera's dots each time the selection changes.
 */
import { Fragment, useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L, { latLng, latLngBounds, type LatLngBounds } from 'leaflet';
import type { CameraReadings, DeploymentListItem } from '../../api/deployments';
import { BaseLayersControl, MapAttribution, MAP_MAX_ZOOM } from '../map/BaseLayersControl';
import { FullscreenControl } from '../map/FullscreenControl';
import { SiteMarkersLayer, type SitePin } from '../sites/SiteMarkersLayer';
import 'leaflet/dist/leaflet.css';

const TEAL = '#0f6064';
const ORANGE = '#ff8945';
const FADED = '#6b7280';

/** A move drawn as an arrow from the old pin to the new one. */
export interface MapArrow {
  key: string;
  from: [number, number];
  to: [number, number];
  warn: boolean; // orange: the out leg of a trip that came back within a week
  strong: boolean; // the selected entry, or every arrow when none is selected
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
  height: number;
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

// Arrow heads stop short of the pin they point at, so the site marker does
// not cover them.
const HEAD_AT = 0.85;

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
      <BaseLayersControl />
      <SiteMarkersLayer
        sites={placed}
        onSiteClick={onSiteClick}
        isFaded={(s) => (selected !== null ? s.id !== selected.site_id : activeSiteIds !== null && !activeSiteIds.has(s.id))}
      />
      {arrows.map((a) => {
        const color = a.warn ? ORANGE : TEAL;
        return (
          <Fragment key={a.key}>
            <Polyline positions={[a.from, a.to]} pathOptions={{ color, weight: a.strong ? 4 : 2.5, opacity: a.strong ? 0.95 : 0.3 }}>
              <Tooltip sticky>{a.label}</Tooltip>
            </Polyline>
            <Marker
              position={[a.from[0] + (a.to[0] - a.from[0]) * HEAD_AT, a.from[1] + (a.to[1] - a.from[1]) * HEAD_AT]}
              icon={arrowHead(bearing(a.from, a.to), color)}
              opacity={a.strong ? 1 : 0.35}
              interactive={false}
            />
          </Fragment>
        );
      })}
      {ordered.map((d) => {
        const strong = d.deployment_id === selected?.id;
        return (
          <CircleMarker
            key={`${d.deployment_id}-${d.latitude}-${d.longitude}`}
            center={[d.latitude, d.longitude]}
            radius={4}
            pathOptions={{
              color: strong ? TEAL : FADED,
              weight: 1,
              fillColor: strong ? TEAL : FADED,
              fillOpacity: strong ? 0.7 : 0.25,
              opacity: strong ? 0.9 : 0.35,
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
        <>
          <Circle
            center={pin}
            radius={readings.threshold_m}
            pathOptions={{ color: TEAL, weight: 1.5, dashArray: '6 4', fill: false }}
          />
          <CircleMarker
            center={pin}
            radius={7}
            pathOptions={{ color: TEAL, weight: 3, fillColor: '#ffffff', fillOpacity: 1 }}
          >
            <Tooltip>The pin, the mean of the photos' GPS</Tooltip>
          </CircleMarker>
        </>
      )}
      <FitOnSelection selectionKey={selected?.id ?? null} bounds={fitBounds} />
      {onSpotClick && <SpotClicks onSpotClick={onSpotClick} />}
      <FullscreenControl />
    </MapContainer>
  );
}
