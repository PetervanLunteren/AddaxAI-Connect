/**
 * A thumbnail framed on one detection box.
 *
 * The dashboard shows photographs to answer "what is this animal", so a
 * full frame with a 60-pixel deer in the corner is useless. This zooms and
 * pans the thumbnail so the detection sits in the middle at a readable size,
 * while keeping enough surroundings that the habitat is still visible.
 *
 * The maths needs the container's aspect ratio, so the caller passes it and
 * the component sets it, rather than measuring the DOM. Everything else comes
 * from the image list response, which already carries the boxes in original
 * pixels plus the original width and height.
 *
 * Falls back to a plain cover image whenever the box or the dimensions are
 * missing, so a partially processed image never renders as a blank card.
 */
import React from 'react';
import { AuthenticatedImage } from '../AuthenticatedImage';
import type { Detection } from '../../api/types';

/** Share of the frame the detection should fill. Leaves room for context. */
const FILL = 0.55;
/** Never zoom past this, a tiny far-away box would turn into mush. */
const MAX_ZOOM = 6;

interface DetectionCropProps {
  thumbnailUrl: string;
  alt: string;
  detections: Detection[];
  imageWidth: number | null;
  imageHeight: number | null;
  /** Container aspect ratio as width / height. Must match the CSS box. */
  aspect: number;
  className?: string;
}

/** The detection to frame: the most confident one, animals preferred. */
function pickDetection(detections: Detection[]): Detection | null {
  if (detections.length === 0) return null;
  const animals = detections.filter((d) => d.category === 'animal');
  const pool = animals.length > 0 ? animals : detections;
  return pool.reduce((best, d) => (d.confidence > best.confidence ? d : best));
}

export const DetectionCrop: React.FC<DetectionCropProps> = ({
  thumbnailUrl,
  alt,
  detections,
  imageWidth,
  imageHeight,
  aspect,
  className = '',
}) => {
  const detection = pickDetection(detections);

  if (!detection || !imageWidth || !imageHeight) {
    return (
      <div className={`overflow-hidden bg-muted ${className}`}>
        <AuthenticatedImage
          src={thumbnailUrl}
          alt={alt}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  // Box as fractions of the original image.
  const fw = detection.bbox.width / imageWidth;
  const fh = detection.bbox.height / imageHeight;
  const cx = (detection.bbox.x + detection.bbox.width / 2) / imageWidth;
  const cy = (detection.bbox.y + detection.bbox.height / 2) / imageHeight;

  // How tall the image renders, as a multiple of its own displayed width,
  // expressed against the container. Keeps the picture undistorted.
  const heightRatio = (aspect * imageHeight) / imageWidth;

  // Zoom so the box fills FILL of the frame in whichever direction is tighter.
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(1, Math.min(FILL / Math.max(fw, 0.001), FILL / Math.max(fh * heightRatio, 0.001))),
  );

  const widthPct = zoom * 100;
  const heightPct = zoom * heightRatio * 100;

  return (
    <div className={`relative overflow-hidden bg-muted ${className}`}>
      <AuthenticatedImage
        src={thumbnailUrl}
        alt={alt}
        className="absolute max-w-none"
        style={{
          width: `${widthPct}%`,
          height: `${heightPct}%`,
          left: `${(0.5 - cx * zoom) * 100}%`,
          top: `${(0.5 - cy * zoom * heightRatio) * 100}%`,
        }}
      />
    </div>
  );
};
