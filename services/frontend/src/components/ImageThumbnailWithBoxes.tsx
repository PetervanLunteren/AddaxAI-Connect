/**
 * Image thumbnail with bounding boxes overlay
 */
import React, { useRef, useEffect, useState } from 'react';
import { AuthenticatedImage } from './AuthenticatedImage';
import type { Detection } from '../api/types';

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

    // Calculate scale factors from original image size to canvas size
    // No offset needed since we're using object-contain (no cropping)
    const scaleX = canvas.width / imageWidth;
    const scaleY = canvas.height / imageHeight;

    // Draw each detection bounding box
    detections.forEach((detection, index) => {
      const bbox = detection.bbox;

      // Scale bbox coordinates from original image to canvas size
      const x = bbox.x * scaleX;
      const y = bbox.y * scaleY;
      const width = bbox.width * scaleX;
      const height = bbox.height * scaleY;

      // Use consistent color for all boxes
      const color = '#0f6064';

      // Draw rectangle
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, width, height);

      // For thumbnails, optionally draw a small label
      // Only show label if box is large enough
      if (width > 40 && height > 30) {
        const label = detection.category;
        const confidence = Math.round(detection.confidence * 100);
        const text = `${label} ${confidence}%`;

        ctx.font = 'bold 10px sans-serif';
        const textMetrics = ctx.measureText(text);
        const textWidth = textMetrics.width;
        const textHeight = 14;

        // Draw label background
        ctx.fillStyle = color;
        ctx.fillRect(x, y - textHeight - 2, textWidth + 4, textHeight + 2);

        // Draw label text
        ctx.fillStyle = 'white';
        ctx.fillText(text, x + 2, y - 4);
      }
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
