/**
 * Default cluster layer for detection rate map
 * Uses standard gray cluster markers (no custom coloring)
 */
import MarkerClusterGroup from 'react-leaflet-cluster';
import type { DeploymentFeature } from '../../api/types';
import { DeploymentMarker } from './DeploymentMarker';

interface DefaultClusterLayerProps {
  deployments: DeploymentFeature[];
  getMarkerColor: (feature: DeploymentFeature) => string;
}

export function DefaultClusterLayer({ deployments, getMarkerColor }: DefaultClusterLayerProps) {
  return (
    <MarkerClusterGroup
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
