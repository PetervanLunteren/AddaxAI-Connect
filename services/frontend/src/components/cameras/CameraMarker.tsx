/**
 * Camera marker component for the map view
 * Displays a camera location as a colored circle marker with tooltip
 */
import { CircleMarker, Tooltip } from 'react-leaflet';
import type { Camera } from '../../api/types';

interface CameraMarkerProps {
  camera: Camera;
  color: string;
  onClick: () => void;
}

export function CameraMarker({ camera, color, onClick }: CameraMarkerProps) {
  if (!camera.location) return null;

  return (
    <CircleMarker
      center={[camera.location.lat, camera.location.lon]}
      radius={8}
      pathOptions={{
        fillColor: color,
        fillOpacity: 0.8,
        color: '#555555',
        weight: 1,
        opacity: 1,
      }}
      eventHandlers={{
        click: onClick,
      }}
    >
      <Tooltip>{camera.name}</Tooltip>
    </CircleMarker>
  );
}
