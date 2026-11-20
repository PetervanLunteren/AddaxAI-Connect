/**
 * The map of the Deployments page.
 *
 * Without a selection it shows the sites of the rows in view; a click on a
 * site filters the timeline to it. With a deployment selected it also shows
 * where the photos of that camera were taken: the dots of the selected
 * deployment strong, the camera's other dots faded, the pin of the
 * deployment and the ring of the move rule around it. The map fits to the
 * camera's dots each time the selection changes.
 */
import { useEffect, useMemo } from 'react';
import { Circle, CircleMarker, MapContainer, Tooltip, useMap } from 'react-leaflet';
import { latLng, latLngBounds, type LatLngBounds } from 'leaflet';
import type { CameraReadings, DeploymentListItem } from '../../api/deployments';
import { BaseLayersControl, MapAttribution, MAP_MAX_ZOOM } from '../map/BaseLayersControl';
import { FitBounds } from '../map/FitBounds';
import { FullscreenControl } from '../map/FullscreenControl';
import { SiteMarkersLayer, type SitePin } from '../sites/SiteMarkersLayer';
import 'leaflet/dist/leaflet.css';

const TEAL = '#0f6064';
const FADED = '#6b7280';

interface Props {
  sites: SitePin[];
  selected: DeploymentListItem | null;
  readings: CameraReadings | undefined;
  onSiteClick: (siteId: number) => void;
  height: number;
}

/**
 * Fit to all the camera's dots and the ring around the pin, once per
 * selection and only when the GPS has arrived, so the earlier place of a
 * move is in view. A user who zooms afterwards is not thrown back.
 */
function FitToSelection({ selectionKey, bounds }: { selectionKey: number; bounds: LatLngBounds | null }) {
  const map = useMap();
  const ready = bounds !== null;
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, ready, map]);
  return null;
}

export function DeploymentsMap({ sites, selected, readings, onSiteClick, height }: Props) {
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
      <FitBounds points={sitePoints} />
      <SiteMarkersLayer
        sites={placed}
        onSiteClick={onSiteClick}
        isFaded={(s) => selected !== null && s.id !== selected.site_id}
      />
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
      {selected && <FitToSelection selectionKey={selected.id} bounds={fitBounds} />}
      <FullscreenControl />
    </MapContainer>
  );
}
