/**
 * Pick a site on the map: every site of the project as a pin, the chosen one
 * magenta, a click on a pin chooses it. Shared by the forms that choose a
 * site: Set site (where a camera stood) and Merge site (which site to keep).
 * Site names often say nothing about place ("Camera 1", "Site at 52.09,
 * 5.81"), so the map is what tells two sites 180 m apart from each other.
 *
 * On satellite, as every map where a place is decided. Pins, rings and colours
 * come from SiteMarkersLayer and
 * marker-style.ts. Selection only: the form owns the chosen id.
 */
import { useEffect, useMemo } from 'react';
import { MapContainer, useMap } from 'react-leaflet';
import type { SiteListItem } from '../../api/sites';
import { BaseLayersControl, MapAttribution, MAP_MAX_ZOOM } from '../map/BaseLayersControl';
import { FitBounds } from '../map/FitBounds';
import { FullscreenControl } from '../map/FullscreenControl';
import { FOCUS_COLOR, SITE_COLOR } from '../map/marker-style';
import { SiteMarkersLayer } from './SiteMarkersLayer';
import 'leaflet/dist/leaflet.css';

const at = (s: SiteListItem): [number, number] => [s.latitude as number, s.longitude as number];

interface Props {
  sites: SiteListItem[];
  selectedId: number | null;
  onSelect: (siteId: number) => void;
  // A site with a meaning of its own (the site a merge removes): its colour,
  // and it cannot be chosen.
  fixed?: { id: number; color: string };
  // The sites to fit the map to at first; all sites when empty.
  fitIds?: (number | null)[];
  height?: number;
}

/** Bring the chosen site into view when it is picked from the list. */
function KeepInView({ point }: { point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!point || map.getBounds().contains(point)) return;
    map.fitBounds(map.getBounds().extend(point), { padding: [30, 30], animate: false });
  }, [point, map]);
  return null;
}

export function SitePickMap({ sites, selectedId, onSelect, fixed, fitIds = [], height = 220 }: Props) {
  // Every site has a NOT NULL location, so this filter is defensive only.
  const located = useMemo(() => sites.filter((s) => s.latitude != null && s.longitude != null), [sites]);
  // FitBounds fits once; a site picked later is brought into view by
  // KeepInView.
  const fitPoints = useMemo(() => {
    const wanted = located.filter((s) => fitIds.includes(s.id));
    return (wanted.length > 0 ? wanted : located).map(at);
  }, [located, fitIds]);
  const selected = located.find((s) => s.id === selectedId);

  if (located.length === 0) return null;
  return (
    <div className="rounded-md border overflow-hidden" style={{ height }}>
      <MapContainer
        center={fitPoints[0]}
        zoom={14}
        maxZoom={MAP_MAX_ZOOM}
        style={{ height: '100%', width: '100%', zIndex: 0 }}
        attributionControl={false}
      >
        <MapAttribution />
        <BaseLayersControl initial="satellite" />
        <SiteMarkersLayer
          sites={located}
          onSiteClick={(id) => id !== fixed?.id && onSelect(id)}
          colorFor={(s) => (s.id === fixed?.id ? fixed.color : s.id === selectedId ? FOCUS_COLOR : SITE_COLOR)}
        />
        <FitBounds points={fitPoints} maxZoom={16} />
        <KeepInView point={selected ? at(selected) : null} />
        <FullscreenControl />
      </MapContainer>
    </div>
  );
}
