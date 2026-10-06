/**
 * Sites map view.
 *
 * Plots each site as one marker. In "none" mode every marker is the plain teal
 * place colour. In a health mode (status, battery, signal) the marker takes the
 * colour of the worst camera at that site, with a legend, so a dead or low
 * camera is visible without opening anything. Mirrors the old cameras map (same
 * base layers, fit-to-bounds, fullscreen control, marker style). Clicking a
 * marker opens the site detail panel. Sites are usually >100 m apart, but
 * sub-100 m sites exist (e.g. cameras on one pole), so overlapping pins
 * spiderfy out.
 */
import { useMemo, useEffect, useRef } from 'react';
import { MapContainer, Marker, Tooltip, useMap } from 'react-leaflet';
import { latLngBounds } from 'leaflet';
import L from 'leaflet';
import type { SiteListItem } from '../../api/sites';
import { FullscreenControl } from '../map/FullscreenControl';
import { BaseLayersControl, MapAttribution, MAP_MAX_ZOOM } from '../map/BaseLayersControl';
import { SpiderLegLine } from '../map/SpiderLegLine';
import { useSpiderfied } from '../../hooks/useSpiderfied';
import { getLegendItems, type ColorByMetric } from '../../utils/camera-colors';
import { getSiteColor, type SiteColorMode, type SiteHealth } from '../../utils/site-health';
import 'leaflet/dist/leaflet.css';

// Primary teal, matching the design system. Used for plain place markers.
const SITE_COLOR = '#0f6064';

const LEGEND_TITLES: Record<ColorByMetric, string> = {
  status: 'Status',
  battery: 'Battery',
  signal: 'Signal',
};

interface SitesMapViewProps {
  sites: SiteListItem[];
  onSiteClick: (siteId: number) => void;
  colorMode: SiteColorMode;
  siteHealth: Map<number, SiteHealth>;
  /** When set (admin contexts), the map shows a control that selects every
   * site inside the current view, feeding the same bulk-edit selection the
   * table uses. */
  onSelectInView?: (siteIds: number[]) => void;
}

// Icons are pure functions of their colour, so cache them by colour string to
// avoid rebuilding identical divIcons on every render.
const iconCache = new Map<string, L.DivIcon>();
function siteIcon(color: string): L.DivIcon {
  let icon = iconCache.get(color);
  if (!icon) {
    icon = L.divIcon({
      className: 'site-marker-icon',
      html: `<div style="
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background-color: ${color};
        border: 2px solid #555555;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    iconCache.set(color, icon);
  }
  return icon;
}

// Spreads overlapping site pins (sub-100 m sites) like the cameras map.
function SpiderfiedSiteLayer({
  sites,
  colorMode,
  siteHealth,
  onSiteClick,
}: {
  sites: SiteListItem[];
  colorMode: SiteColorMode;
  siteHealth: Map<number, SiteHealth>;
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
          icon={siteIcon(getSiteColor(siteHealth.get(item.id), colorMode, SITE_COLOR))}
          eventHandlers={{ click: () => onSiteClick(item.id) }}
        >
          <Tooltip>{item.name}</Tooltip>
        </Marker>
      ))}
    </>
  );
}

// Bottom-right legend, added only while a health mode is active. Same Leaflet
// control pattern the cameras map used, so it sits inside the map pane with no
// z-index conflict with the filter bar above.
function SiteMapLegend({ colorMode }: { colorMode: ColorByMetric }) {
  const map = useMap();
  useEffect(() => {
    const legend = new L.Control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'info legend');
      div.style.backgroundColor = 'white';
      div.style.padding = '10px';
      div.style.borderRadius = '4px';
      div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      const items = getLegendItems(colorMode);
      div.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px;">
          ${LEGEND_TITLES[colorMode]}
        </div>
        ${items
          .map(
            (item) => `
          <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <span style="
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: ${item.color};
              border: 1px solid #555555;
              margin-right: 8px;
              flex-shrink: 0;
            "></span>
            <span style="font-size: 11px;">${item.label}</span>
          </div>
        `,
          )
          .join('')}
      `;
      return div;
    };
    legend.addTo(map);
    return () => {
      legend.remove();
    };
  }, [map, colorMode]);
  return null;
}

const SELECT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M14 3h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="m12 12 4 10 1.7-4.3L22 16Z"/></svg>`;

/** Leaflet control that selects every site inside the current view, same
 * pattern as FullscreenControl. The sites live in a ref so the control,
 * built once, always reads the current list. */
function SelectInViewControl({
  sites,
  onSelect,
}: {
  sites: SiteListItem[];
  onSelect: (siteIds: number[]) => void;
}) {
  const map = useMap();
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const control = new L.Control({ position: 'topright' });
    control.onAdd = () => {
      const container = L.DomUtil.create('div', 'leaflet-bar');
      const btn = L.DomUtil.create('button', '', container) as HTMLButtonElement;
      btn.type = 'button';
      btn.title = 'Select sites in view';
      btn.innerHTML = SELECT_ICON;
      btn.style.cssText =
        'display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:white;border:none;cursor:pointer;';
      L.DomEvent.disableClickPropagation(container);
      btn.addEventListener('click', () => {
        const bounds = map.getBounds();
        const ids = sitesRef.current
          .filter(
            (s) =>
              s.latitude != null &&
              s.longitude != null &&
              bounds.contains([s.latitude, s.longitude]),
          )
          .map((s) => s.id);
        onSelectRef.current(ids);
      });
      return container;
    };
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
  return null;
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

export function SitesMapView({
  sites,
  onSiteClick,
  colorMode,
  siteHealth,
  onSelectInView,
}: SitesMapViewProps) {
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
        maxZoom={MAP_MAX_ZOOM}
        style={{ height: '500px', width: '100%', zIndex: 0 }}
        attributionControl={false}
        className="rounded-lg border border-gray-200"
      >
        <MapAttribution />
        <BaseLayersControl />
        <FitBounds points={points} />
        <SpiderfiedSiteLayer
          sites={sitesWithLocation}
          colorMode={colorMode}
          siteHealth={siteHealth}
          onSiteClick={onSiteClick}
        />
        {colorMode !== 'none' && <SiteMapLegend colorMode={colorMode} />}
        <FullscreenControl />
        {onSelectInView && (
          <SelectInViewControl sites={sitesWithLocation} onSelect={onSelectInView} />
        )}
      </MapContainer>
    </div>
  );
}
