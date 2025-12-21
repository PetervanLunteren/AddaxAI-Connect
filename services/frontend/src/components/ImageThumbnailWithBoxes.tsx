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

    // Get natural (actual loaded) image dimensions
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate scale and offset for object-cover
    // The image is scaled to cover the container, which may crop it
    const containerAspect = canvas.width / canvas.height;
    const imageAspect = naturalWidth / naturalHeight;

    console.log('Aspect ratios:', { containerAspect, imageAspect, naturalWidth, naturalHeight });

    let renderWidth, renderHeight, offsetX, offsetY;

    if (imageAspect > containerAspect) {
      // Image is wider - will be cropped on left/right
      renderHeight = canvas.height;
      renderWidth = naturalWidth * (canvas.height / naturalHeight);
      offsetX = (canvas.width - renderWidth) / 2;
      offsetY = 0;
    } else {
      // Image is taller - will be cropped on top/bottom
      renderWidth = canvas.width;
      renderHeight = naturalHeight * (canvas.width / naturalWidth);
      offsetX = 0;
      offsetY = (canvas.height - renderHeight) / 2;
    }

    console.log('Render dimensions:', { renderWidth, renderHeight, offsetX, offsetY });

    const scaleX = renderWidth / naturalWidth;
    const scaleY = renderHeight / naturalHeight;

    console.log('Scale factors:', { scaleX, scaleY });

    // Draw each detection bounding box
    detections.forEach((detection, index) => {
      const bbox = detection.bbox;

      // Scale and offset bbox coordinates
      const x = bbox.x * scaleX + offsetX;
      const y = bbox.y * scaleY + offsetY;
      const width = bbox.width * scaleX;
      const height = bbox.height * scaleY;

      console.log(`Detection ${index}:`, {
        category: detection.category,
        originalBbox: bbox,
        scaledBbox: { x, y, width, height }
      });

      // Generate a color based on detection index
      const hue = (index * 137.5) % 360; // Golden angle for good distribution
      const color = `hsl(${hue}, 70%, 50%)`;

      // Draw rectangle
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
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
