/**
 * Cluster layer for detection rate map
 * Groups nearby deployments into colored clusters
 */
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { DeploymentFeature } from '../../api/types';
import { DeploymentMarker } from './DeploymentMarker';
import { getDetectionRateColor } from '../../utils/color-scale';

interface ClusterLayerProps {
  deployments: DeploymentFeature[];
  maxDetectionRate: number;
  getMarkerColor: (feature: DeploymentFeature) => string;
}

export function ClusterLayer({ deployments, maxDetectionRate, getMarkerColor }: ClusterLayerProps) {
  // Create a map of coordinates to deployment features for quick lookup
  const coordsToFeature = new Map<string, DeploymentFeature>();
  deployments.forEach((feature) => {
    const key = `${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}`;
    coordsToFeature.set(key, feature);
  });

  // Custom icon creation function for colored clusters
  const createClusterCustomIcon = (cluster: L.MarkerCluster) => {
    const markers = cluster.getAllChildMarkers();

    // Calculate average detection rate for all deployments in this cluster
    let totalRate = 0;
    let count = 0;

    markers.forEach((marker: any) => {
      const latlng = marker.getLatLng();
      const key = `${latlng.lat},${latlng.lng}`;
      const feature = coordsToFeature.get(key);

      if (feature) {
        totalRate += feature.properties.detection_rate_per_100;
        count++;
      }
    });

    const avgRate = count > 0 ? totalRate / count : 0;

    // Get color for this average rate
    const color = getDetectionRateColor(avgRate, maxDetectionRate);

    return L.divIcon({
      html: `<div style="
        background-color: ${color};
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 2px solid #555555;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 14px;
        text-shadow: 0 0 2px rgba(0,0,0,0.5);
      ">${count}</div>`,
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
      {deployments.map((feature) => {
        const color = getMarkerColor(feature);

        return (
          <DeploymentMarker
            key={feature.id}
            feature={feature}
            color={color}
          />
        );
      })}
    </MarkerClusterGroup>
  );
}
