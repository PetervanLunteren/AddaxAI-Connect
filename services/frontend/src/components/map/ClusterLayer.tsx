/**
 * Cluster layer for detection rate map
 * Groups nearby sites into colored clusters
 */
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { SiteFeature } from '../../api/types';
import type { MapMetric } from '../../utils/map-metrics';
import { SiteMarker } from './SiteMarker';
import { getDetectionRateColor } from '../../utils/color-scale';

interface ClusterLayerProps {
  sites: SiteFeature[];
  metric: MapMetric;
  domainMax: number;
  getMarkerColor: (feature: SiteFeature) => string;
}

export function ClusterLayer({ sites, metric, domainMax, getMarkerColor }: ClusterLayerProps) {
  // Map of coordinates to site feature for quick lookup.
  const coordsToFeature = new Map<string, SiteFeature>();
  sites.forEach((feature) => {
    const key = `${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}`;
    coordsToFeature.set(key, feature);
  });

  // Custom icon creation function for colored clusters
  const createClusterCustomIcon = (cluster: L.MarkerCluster) => {
    const markers = cluster.getAllChildMarkers();

    const members: SiteFeature[] = [];
    markers.forEach((marker: L.Marker) => {
      const latlng = marker.getLatLng();
      const feature = coordsToFeature.get(`${latlng.lat},${latlng.lng}`);
      if (feature) members.push(feature);
    });

    // The metric defines how member sites pool (same rule as hexbins)
    const value = metric.aggregate(members.map((f) => f.properties));

    // Hollow cluster icon when every member site is empty for this metric,
    // matching the points and hexbin views.
    const isZero = members.every((f) => metric.isEmpty(f.properties));
    const color = getDetectionRateColor(value, domainMax);
    const background = isZero ? 'transparent' : color;
    const textColor = isZero ? '#555555' : 'white';
    const textShadow = isZero ? 'none' : '0 0 2px rgba(0,0,0,0.5)';

    return L.divIcon({
      html: `<div style="
        background-color: ${background};
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 2px solid #555555;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${textColor};
        font-weight: bold;
        font-size: 14px;
        text-shadow: ${textShadow};
      ">${metric.formatShort(value)}</div>`,
      className: 'custom-cluster-icon',
      iconSize: L.point(40, 40, true),
    });
  };

  return (
    <MarkerClusterGroup
      key={`clusters-${metric.id}`}
      iconCreateFunction={createClusterCustomIcon}
      maxClusterRadius={50}
      spiderfyOnMaxZoom={true}
      showCoverageOnHover={false}
      zoomToBoundsOnClick={true}
    >
      {sites.map((feature) => {
        const color = getMarkerColor(feature);

        return (
          <SiteMarker
            key={feature.id}
            feature={feature}
            color={color}
            metric={metric}
          />
        );
      })}
    </MarkerClusterGroup>
  );
}
