/**
 * Camera marker component for the map view
 * Displays a camera location as a colored circle marker with tooltip
 */
import { useMemo } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import type { Camera } from '../../api/types';

interface CameraMarkerProps {
  camera: Camera;
  color: string;
  onClick: () => void;
  /** Optional position override for spiderfying */
  position?: [number, number];
}

export function CameraMarker({
  camera,
  color,
  onClick,
  position,
}: CameraMarkerProps) {
  if (!camera.location) return null;

  // Use provided position or fall back to camera's real location
  const markerPosition: [number, number] = position ?? [
    camera.location.lat,
    camera.location.lon,
  ];

  // Memoize icon to prevent recreation on every render
  const icon = useMemo(
    () =>
      L.divIcon({
        className: 'camera-marker-icon',
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
      }),
    [color]
  );

  return (
    <Marker
      position={markerPosition}
      icon={icon}
      eventHandlers={{ click: onClick }}
    >
      <Tooltip>{camera.name}</Tooltip>
    </Marker>
  );
}
