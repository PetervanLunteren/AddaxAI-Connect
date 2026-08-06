/**
 * A thumbnail framed on one detection box.
 *
 * The dashboard shows photographs to answer "what is this animal", so a
 * full frame with a 60-pixel deer in the corner is useless. This zooms and
 * pans the thumbnail so the detection sits in the middle at a readable size,
 * while keeping enough surroundings that the habitat is still visible.
 *
 * The maths needs the container's aspect ratio, and the component measures it
 * rather than being told. A caller that stretches to fill a grid row does not
 * know its own shape, and a wrong aspect quietly slides the animal off centre.
 * Everything else comes from the image list response, which already carries
 * the boxes in original pixels plus the original width and height.
 *
 * Falls back to a plain cover image whenever the box or the dimensions are
 * missing, so a partially processed image never renders as a blank card.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AuthenticatedImage } from '../AuthenticatedImage';
import type { Detection } from '../../api/types';

/** Share of the frame the detection should fill. Leaves room for context. */
const FILL = 0.5;

interface DetectionCropProps {
  /**
   * Which rendering of the image to frame. Thumbnails are 300px wide, so
   * magnifying a small box out of one turns to mush: a 91-pixel animal in a
   * 1984-pixel original is only 14 pixels there. Large tiles should pass the
   * full-size URL and small ones the thumbnail.
   */
  imageUrl: string;
  alt: string;
  detections: Detection[];
  imageWidth: number | null;
  imageHeight: number | null;
  /**
   * Upper bound on magnification. Pick it from the source: roughly the
   * container width divided by the source width, so the picture is never
   * stretched much past its real resolution.
   */
  maxZoom?: number;
  className?: string;
}

/**
 * The detection to frame: the most confident one, animals preferred.
 *
 * Exported so the photo wall can score a picture on the same box it will end
 * up showing. Judging one detection and then framing another would rank a
 * photo on an animal the viewer never sees.
 */
export function pickDetection(detections: Detection[]): Detection | null {
  if (detections.length === 0) return null;
  const animals = detections.filter((d) => d.category === 'animal');
  const pool = animals.length > 0 ? animals : detections;
  return pool.reduce((best, d) => (d.confidence > best.confidence ? d : best));
}

export const DetectionCrop: React.FC<DetectionCropProps> = ({
  imageUrl,
  alt,
  detections,
  imageWidth,
  imageHeight,
  maxZoom = 6,
  className = '',
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  // Starts null so nothing is drawn from a guessed shape. One frame of empty
  // frame beats a frame of the animal in the wrong place.
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0) setAspect(width / height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const detection = pickDetection(detections);
  const canCrop = detection !== null && !!imageWidth && !!imageHeight && aspect !== null;

  // One element either way, so the ref keeps pointing at the same node and the
  // observer survives the switch from unmeasured to cropped.
  return (
    <div ref={boxRef} className={`relative overflow-hidden bg-muted ${className}`}>
      {canCrop ? (
        <CroppedImage
          imageUrl={imageUrl}
          alt={alt}
          detection={detection}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          aspect={aspect}
          maxZoom={maxZoom}
        />
      ) : detection === null || !imageWidth || !imageHeight ? (
        <AuthenticatedImage src={imageUrl} alt={alt} className="h-full w-full object-cover" />
      ) : null}
    </div>
  );
};

/** The framing maths, split out so the wrapper can stay a single stable node. */
const CroppedImage: React.FC<{
  imageUrl: string;
  alt: string;
  detection: Detection;
  imageWidth: number;
  imageHeight: number;
  aspect: number;
  maxZoom: number;
}> = ({ imageUrl, alt, detection, imageWidth, imageHeight, aspect, maxZoom }) => {
  // Box as fractions of the original image.
  const fw = detection.bbox.width / imageWidth;
  const fh = detection.bbox.height / imageHeight;
  const cx = (detection.bbox.x + detection.bbox.width / 2) / imageWidth;
  const cy = (detection.bbox.y + detection.bbox.height / 2) / imageHeight;

  // How tall the image renders, as a multiple of its own displayed width,
  // expressed against the container. Keeps the picture undistorted.
  const heightRatio = (aspect * imageHeight) / imageWidth;

  // Smallest zoom that still covers the frame in both directions. Width is
  // covered at zoom 1 by definition; height needs more whenever the image is
  // relatively wider than its container.
  const coverZoom = Math.max(1, 1 / heightRatio);

  // Zoom so the box fills FILL of the frame in whichever direction is tighter,
  // never below what it takes to cover.
  const zoom = Math.min(
    maxZoom,
    Math.max(
      coverZoom,
      Math.min(FILL / Math.max(fw, 0.001), FILL / Math.max(fh * heightRatio, 0.001)),
    ),
  );

  const widthFraction = zoom;
  const heightFraction = zoom * heightRatio;

  return (
    <AuthenticatedImage
      src={imageUrl}
      alt={alt}
      className="absolute max-w-none"
      style={{
        width: `${widthFraction * 100}%`,
        height: `${heightFraction * 100}%`,
        left: `${place(widthFraction, cx) * 100}%`,
        top: `${place(heightFraction, cy) * 100}%`,
      }}
    />
  );
};

/**
 * Where to put one edge of the image so the detection sits as central as it
 * can without uncovering the frame.
 *
 * Centring alone is not enough. A large animal needs little or no zoom, and
 * an off-centre one then drags the picture sideways until bare card shows at
 * the edge. Ranking photographs by how much of the frame the animal fills
 * made that the common case rather than the rare one.
 *
 * `fraction` is the rendered size of the image as a multiple of the frame,
 * `centre` is where the detection sits in the image, 0 to 1.
 */
function place(fraction: number, centre: number): number {
  // Cannot cover, so centre the shortfall rather than leaving it all on one
  // side. Only reachable when maxZoom is too low for a very wide image.
  if (fraction <= 1) return (1 - fraction) / 2;
  const centred = 0.5 - centre * fraction;
  // Never past the leading edge, never short of the trailing one.
  return Math.min(0, Math.max(1 - fraction, centred));
}
