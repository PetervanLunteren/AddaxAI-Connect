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

  // Draw bounding boxes on canvas
  useEffect(() => {
    console.log('ImageThumbnailWithBoxes useEffect:', {
      imageLoaded,
      hasCanvas: !!canvasRef.current,
      hasImage: !!imageRef.current,
      imageWidth,
      imageHeight,
      detectionsCount: detections.length,
      detections,
    });

    if (!imageLoaded || !canvasRef.current || !imageRef.current || !imageWidth || !imageHeight) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = imageRef.current;

    if (!ctx) return;

    console.log('Drawing bounding boxes:', detections.length);

    // Set canvas size to match image display size
    const rect = img.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate scale factors from original image to thumbnail display
    const scaleX = canvas.width / imageWidth;
    const scaleY = canvas.height / imageHeight;

    // Draw each detection bounding box
    detections.forEach((detection, index) => {
      const bbox = detection.bbox;

      // Scale bbox coordinates from original image size to thumbnail size
      const x = bbox.x * scaleX;
      const y = bbox.y * scaleY;
      const width = bbox.width * scaleX;
      const height = bbox.height * scaleY;

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
  }, [imageLoaded, detections, imageWidth, imageHeight]);

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
