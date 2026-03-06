/**
 * Image thumbnail with bounding boxes overlay
 */
import React, { useRef, useEffect, useState } from 'react';
import { AuthenticatedImage } from './AuthenticatedImage';
import type { Detection } from '../api/types';
import { drawDetectionOverlay } from '../utils/detection-overlay';

interface ImageThumbnailWithBoxesProps {
  thumbnailUrl: string;
  alt: string;
  detections: Detection[];
  imageWidth: number | null;
  imageHeight: number | null;
  className?: string;
  fallback?: React.ReactNode;
}

export const ImageThumbnailWithBoxes: React.FC<ImageThumbnailWithBoxesProps> = ({
  thumbnailUrl,
  alt,
  detections,
  imageWidth,
  imageHeight,
  className = '',
  fallback,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset imageLoaded when thumbnailUrl changes
  useEffect(() => {
    setImageLoaded(false);
  }, [thumbnailUrl]);

  // Draw bounding boxes on canvas
  useEffect(() => {
    // Always clear canvas first, even if we're not drawing
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    if (!imageLoaded || !canvasRef.current || !imageRef.current || !imageWidth || !imageHeight) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = imageRef.current;

    if (!ctx) return;

    // Set canvas size to match image display size
    const rect = img.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Use original image dimensions from database for bbox coordinates
    // The thumbnail loaded is smaller, but bbox coords are based on original image
    if (!imageWidth || !imageHeight) return;

    // Draw spotlight + rounded bboxes (no labels on thumbnails — too small)
    drawDetectionOverlay(ctx, detections, canvas.width, canvas.height, {
      showLabels: false,
      imageWidth,
      imageHeight,
    });
  }, [imageLoaded, detections, imageWidth, imageHeight, alt, thumbnailUrl]);

  return (
    <div className="relative w-full h-full">
      <AuthenticatedImage
        ref={imageRef}
        src={thumbnailUrl}
        alt={alt}
        className={className}
        onLoad={() => setImageLoaded(true)}
        fallback={fallback}
      />
      {detections.length > 0 && (
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />
      )}
    </div>
  );
};
