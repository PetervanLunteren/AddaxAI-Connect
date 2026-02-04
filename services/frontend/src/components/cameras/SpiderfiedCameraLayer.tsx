/**
 * Layer component that renders camera markers with automatic spiderfying
 * Spreads overlapping cameras in a circle pattern with spider lines
 * Must be used as a child of MapContainer
 */
import { Polyline } from 'react-leaflet';
import type { Camera } from '../../api/types';
import {
  useSpiderfiedCameras,
  type SpiderLeg,
} from '../../hooks/useSpiderfiedCameras';
import { CameraMarker } from './CameraMarker';
import {
  getCameraMarkerColor,
  type ColorByMetric,
} from '../../utils/camera-colors';

interface SpiderfiedCameraLayerProps {
  cameras: Camera[];
  colorBy: ColorByMetric;
  onCameraClick: (camera: Camera) => void;
}

const SPIDER_LEG_STYLE = {
  color: '#666666',
  weight: 1.5,
  opacity: 0.6,
};

/**
 * Interpolate between two points at a given ratio (0 = start, 1 = end)
 */
function interpolate(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  ratio: number
): [number, number] {
  return [
    start.lat + (end.lat - start.lat) * ratio,
    start.lon + (end.lon - start.lon) * ratio,
  ];
}

function SpiderLegLine({ leg }: { leg: SpiderLeg }) {
  // Draw line from 10% to 90% to leave gaps at both ends
  const startPoint = interpolate(leg.displayPosition, leg.realPosition, 0.1);
  const endPoint = interpolate(leg.displayPosition, leg.realPosition, 0.9);

  return (
    <Polyline
      positions={[startPoint, endPoint]}
      pathOptions={SPIDER_LEG_STYLE}
    />
  );
}

export function SpiderfiedCameraLayer({
  cameras,
  colorBy,
  onCameraClick,
}: SpiderfiedCameraLayerProps) {
  const { spiderfiedCameras, spiderLegs } = useSpiderfiedCameras(cameras, {
    proximityThresholdMeters: 100,
    spreadRadiusPixels: 40,
  });

  return (
    <>
      {/* Draw spider legs first (behind markers) */}
      {spiderLegs.map((leg) => (
        <SpiderLegLine key={`leg-${leg.cameraId}`} leg={leg} />
      ))}

      {/* Draw camera markers on top */}
      {spiderfiedCameras.map((sc) => (
        <CameraMarker
          key={sc.camera.id}
          camera={sc.camera}
          color={getCameraMarkerColor(sc.camera, colorBy)}
          onClick={() => onCameraClick(sc.camera)}
          position={[sc.displayPosition.lat, sc.displayPosition.lon]}
        />
      ))}
    </>
  );
}
