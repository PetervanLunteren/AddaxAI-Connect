/**
 * Cluster layer for detection rate map
 * Groups nearby sites into colored clusters
 */
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { SiteFeature } from '../../api/types';
import { SiteMarker } from './SiteMarker';
import { getDetectionRateColor } from '../../utils/color-scale';

interface ClusterLayerProps {
  sites: SiteFeature[];
  maxDetectionRate: number;
  getMarkerColor: (feature: SiteFeature) => string;
}

export function ClusterLayer({ sites, maxDetectionRate, getMarkerColor }: ClusterLayerProps) {
  // Map of coordinates to site feature for quick lookup.
  const coordsToFeature = new Map<string, SiteFeature>();
  sites.forEach((feature) => {
    const key = `${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}`;
    coordsToFeature.set(key, feature);
  });

  // Custom icon creation function for colored clusters
  const createClusterCustomIcon = (cluster: L.MarkerCluster) => {
    const markers = cluster.getAllChildMarkers();

    // Calculate trap-day-weighted detection rate (same as hexbins)
    let totalDetections = 0;
    let totalTrapDays = 0;

    markers.forEach((marker: any) => {
      const latlng = marker.getLatLng();
      const key = `${latlng.lat},${latlng.lng}`;
      const feature = coordsToFeature.get(key);

      if (feature) {
        totalDetections += feature.properties.detection_count;
        totalTrapDays += feature.properties.trap_days;
      }
    });

    // Calculate overall rate: total detections / total trap-days × 100
    const overallRate = totalTrapDays > 0 ? (totalDetections / totalTrapDays) * 100 : 0;

    // Hollow cluster icon when every member site has zero detections,
    // matching the points and hexbin views.
    const isZero = totalDetections === 0;
    const color = getDetectionRateColor(overallRate, maxDetectionRate);
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
      ">${Math.round(overallRate)}</div>`,
      className: 'custom-cluster-icon',
      iconSize: L.point(40, 40, true),
    });
  };

  return (
    <MarkerClusterGroup
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
          />
        );
      })}
    </MarkerClusterGroup>
  );
}
