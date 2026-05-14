/**
 * Deployment marker component
 * Displays a single camera deployment as a colored circle marker
 */
import { CircleMarker, Popup } from 'react-leaflet';
import type { DeploymentFeature } from '../../api/types';
import { DeploymentPopup } from './DeploymentPopup';

interface DeploymentMarkerProps {
  feature: DeploymentFeature;
  color: string;
}

export function DeploymentMarker({ feature, color }: DeploymentMarkerProps) {
  const [lat, lon] = [
    feature.geometry.coordinates[1],
    feature.geometry.coordinates[0],
  ];

  // Hollow circle for zero detections so they read as "deployed, nothing seen"
  // instead of blending with the low end of the colour gradient.
  const isZero = feature.properties.detection_count === 0;

  return (
    <CircleMarker
      center={[lat, lon]}
      radius={8}
      pathOptions={{
        fillColor: color,
        fillOpacity: isZero ? 0 : 0.7,
        color: '#555555', // Dark grey border to match hexagons
        weight: isZero ? 2 : 1,
        opacity: 1,
      }}
    >
      <Popup>
        <DeploymentPopup properties={feature.properties} />
      </Popup>
    </CircleMarker>
  );
}
