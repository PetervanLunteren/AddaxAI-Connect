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

function SpiderLegLine({ leg }: { leg: SpiderLeg }) {
  return (
    <Polyline
      positions={[
        [leg.displayPosition.lat, leg.displayPosition.lon],
        [leg.realPosition.lat, leg.realPosition.lon],
      ]}
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
