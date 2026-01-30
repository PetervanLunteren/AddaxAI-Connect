/**
 * Default cluster layer for detection rate map
 * Uses standard gray cluster markers (no custom coloring)
 */
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { DeploymentFeature } from '../../api/types';
import { DeploymentMarker } from './DeploymentMarker';

interface DefaultClusterLayerProps {
  deployments: DeploymentFeature[];
  getMarkerColor: (feature: DeploymentFeature) => string;
}

export function DefaultClusterLayer({ deployments, getMarkerColor }: DefaultClusterLayerProps) {
  // Create a map of coordinates to deployment features for quick lookup
  const coordsToFeature = new Map<string, DeploymentFeature>();
  deployments.forEach((feature) => {
    const key = `${feature.geometry.coordinates[1]},${feature.geometry.coordinates[0]}`;
    coordsToFeature.set(key, feature);
  });

  // Custom icon creation function for default gray clusters showing average rate
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

    return L.divIcon({
      html: `<div style="
        background-color: #808080;
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
      ">${Math.round(avgRate)}</div>`,
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
