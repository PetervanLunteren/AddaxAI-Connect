/**
 * Layer component that renders camera markers with automatic spiderfying.
 * Spreads overlapping cameras (common now that cameras sit on their site) in a
 * circle with spider lines. Must be used as a child of MapContainer.
 */
import type { Camera } from '../../api/types';
import { useSpiderfied } from '../../hooks/useSpiderfied';
import { SpiderLegLine } from '../map/SpiderLegLine';
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

export function SpiderfiedCameraLayer({
  cameras,
  colorBy,
  onCameraClick,
}: SpiderfiedCameraLayerProps) {
  const { spread, legs } = useSpiderfied(
    cameras,
    (c) => (c.location ? { lat: c.location.lat, lon: c.location.lon } : null),
    (c) => c.id,
    { proximityThresholdPixels: 10, spreadRadiusPixels: 20 },
  );

  return (
    <>
      {legs.map((leg) => (
        <SpiderLegLine key={`leg-${leg.id}`} leg={leg} />
      ))}
      {spread.map(({ item, displayPosition }) => (
        <CameraMarker
          key={item.id}
          camera={item}
          color={getCameraMarkerColor(item, colorBy)}
          onClick={() => onCameraClick(item)}
          position={[displayPosition.lat, displayPosition.lon]}
        />
      ))}
    </>
  );
}
