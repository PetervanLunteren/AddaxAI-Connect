/**
 * Site merge target-picker.
 *
 * Merging fixes GPS-noise duplicates (two pins that are really the same place),
 * so the choice is spatial. This shows every site as a fixed marker: the source
 * (the site being removed) in red, the picked target (the survivor) in teal, and
 * the other sites in light teal. Click a site to pick it as the target. Seeing
 * how close two pins sit is the clearest confirmation that they are one place.
 *
 * Selection only; the parent owns the chosen target id and runs the merge.
 */
import { useMemo, useEffect, useRef } from 'react';
import { MapContainer, Marker, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import L from 'leaflet';
import type { SiteListItem } from '../../api/sites';
import { BaseLayersControl } from '../map/BaseLayersControl';
import { FullscreenControl } from '../map/FullscreenControl';
import 'leaflet/dist/leaflet.css';

// From FRONTEND_CONVENTIONS.md: red = removed, primary teal = kept,
// light teal = other selectable site.
const REMOVED_COLOR = '#882000';
const KEPT_COLOR = '#0f6064';
const OTHER_COLOR = '#71b7ba';

interface Props {
  sites: SiteListItem[];
  // The site being merged away (fixed, not selectable).
  sourceSiteId: number;
  selectedTargetId: number | null;
  onSelectTarget: (siteId: number) => void;
  height?: number;
}

// Same divIcon shape as SiteLocationPicker, kept local rather than shared
// (it is two states there, three here, and not worth a refactor).
function markerIcon(color: string, size: number) {
  return L.divIcon({
    className: 'site-merge-marker',
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      background-color: ${color}; border: 2px solid #555555;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Fit to all plotted sites once, so every merge candidate is visible.
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(latLngBounds(points), { padding: [30, 30] });
    }
    fitted.current = true;
  }, [points, map]);
  return null;
}

function LegendDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full border border-[#555555] align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

export function SiteMergePicker({
  sites,
  sourceSiteId,
  selectedTargetId,
  onSelectTarget,
  height = 420,
}: Props) {
  // Every site has a NOT NULL location, so this filter is defensive only.
  const located = useMemo(
    () => sites.filter((s) => s.latitude != null && s.longitude != null),
    [sites],
  );
  const source = located.find((s) => s.id === sourceSiteId) ?? null;
  const others = useMemo(
    () => located.filter((s) => s.id !== sourceSiteId),
    [located, sourceSiteId],
  );

  const points = useMemo<[number, number][]>(
    () => located.map((s) => [s.latitude as number, s.longitude as number]),
    [located],
  );

  const center = useMemo<[number, number]>(() => {
    if (source) return [source.latitude as number, source.longitude as number];
    if (points.length > 0) return points[0];
    return [52.0, 5.0];
  }, [source, points]);

  const removedIcon = useMemo(() => markerIcon(REMOVED_COLOR, 18), []);
  const keptIcon = useMemo(() => markerIcon(KEPT_COLOR, 18), []);
  const otherIcon = useMemo(() => markerIcon(OTHER_COLOR, 14), []);

  if (others.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        There is no other site to merge into.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border overflow-hidden" style={{ height }}>
        <MapContainer
          center={center}
          zoom={13}
          style={{ height: '100%', width: '100%', zIndex: 0 }}
        >
          <BaseLayersControl />
          <FitBounds points={points} />
          {source && (
            <Marker
              position={[source.latitude as number, source.longitude as number]}
              icon={removedIcon}
            >
              <Tooltip>{source.name} will be removed</Tooltip>
            </Marker>
          )}
          {others.map((s) => {
            const isTarget = s.id === selectedTargetId;
            return (
              <Marker
                key={s.id}
                position={[s.latitude as number, s.longitude as number]}
                icon={isTarget ? keptIcon : otherIcon}
                eventHandlers={{ click: () => onSelectTarget(s.id) }}
              >
                <Tooltip>{isTarget ? `${s.name} kept` : s.name}</Tooltip>
              </Marker>
            );
          })}
          <FullscreenControl />
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <LegendDot color={REMOVED_COLOR} /> Removed
        </span>
        <span className="flex items-center gap-1.5">
          <LegendDot color={KEPT_COLOR} /> Kept
        </span>
        <span className="flex items-center gap-1.5">
          <LegendDot color={OTHER_COLOR} /> Other site
        </span>
      </div>
    </div>
  );
}
