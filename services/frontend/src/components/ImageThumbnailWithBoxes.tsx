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

      // Add padding around bbox
      const bboxPadding = 4;
      const paddedX = x - bboxPadding;
      const paddedY = y - bboxPadding;
      const paddedWidth = width + (bboxPadding * 2);
      const paddedHeight = height + (bboxPadding * 2);

      // Use red color for all boxes
      const color = '#ef4444';

      // Draw corner brackets with rounded corners
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';

      const bracketLength = 10;
      const cornerRadius = 3;

      // Top-left corner
      ctx.beginPath();
      ctx.moveTo(paddedX, paddedY + bracketLength);
      ctx.arcTo(paddedX, paddedY, paddedX + bracketLength, paddedY, cornerRadius);
      ctx.lineTo(paddedX + bracketLength, paddedY);
      ctx.stroke();

      // Top-right corner
      ctx.beginPath();
      ctx.moveTo(paddedX + paddedWidth - bracketLength, paddedY);
      ctx.arcTo(paddedX + paddedWidth, paddedY, paddedX + paddedWidth, paddedY + bracketLength, cornerRadius);
      ctx.lineTo(paddedX + paddedWidth, paddedY + bracketLength);
      ctx.stroke();

      // Bottom-left corner
      ctx.beginPath();
      ctx.moveTo(paddedX + bracketLength, paddedY + paddedHeight);
      ctx.arcTo(paddedX, paddedY + paddedHeight, paddedX, paddedY + paddedHeight - bracketLength, cornerRadius);
      ctx.lineTo(paddedX, paddedY + paddedHeight - bracketLength);
      ctx.stroke();

      // Bottom-right corner
      ctx.beginPath();
      ctx.moveTo(paddedX + paddedWidth, paddedY + paddedHeight - bracketLength);
      ctx.arcTo(paddedX + paddedWidth, paddedY + paddedHeight, paddedX + paddedWidth - bracketLength, paddedY + paddedHeight, cornerRadius);
      ctx.lineTo(paddedX + paddedWidth - bracketLength, paddedY + paddedHeight);
      ctx.stroke();
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
