/**
 * Image detail modal with bounding boxes
 */
import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Calendar, Camera, Download, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, File, Scan, PawPrint } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { imagesApi } from '../api/images';
import { AuthenticatedImage } from './AuthenticatedImage';

interface ImageDetailModalProps {
  imageUuid: string;
  isOpen: boolean;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

export const ImageDetailModal: React.FC<ImageDetailModalProps> = ({
  imageUuid,
  isOpen,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [showBboxes, setShowBboxes] = useState(true);

  const { data: imageDetail, isLoading, error } = useQuery({
    queryKey: ['image', imageUuid],
    queryFn: () => imagesApi.getByUuid(imageUuid),
    enabled: isOpen && !!imageUuid,
  });

  // Fetch authenticated image and create blob URL
  useEffect(() => {
    let objectUrl: string | null = null;

    const fetchAuthenticatedImage = async () => {
      if (!imageDetail?.full_image_url) return;

      try {
        const apiClient = (await import('../api/client')).default;
        const response = await apiClient.get(imageDetail.full_image_url, {
          responseType: 'blob',
        });

        objectUrl = URL.createObjectURL(response.data);
        setImageBlobUrl(objectUrl);
      } catch (err) {
        console.error('Failed to load authenticated full image:', err);
      }
    };

    if (imageDetail) {
      fetchAuthenticatedImage();
    }

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      setImageBlobUrl(null);
      setImageLoaded(false);
    };
  }, [imageDetail]);

  // Draw bounding boxes on canvas
  useEffect(() => {
    if (!imageDetail || !imageLoaded || !canvasRef.current || !imageRef.current) return;

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

    // If bboxes are hidden, just clear and return
    if (!showBboxes) return;

    // Get natural image dimensions
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    // Calculate scale factors
    const scaleX = canvas.width / naturalWidth;
    const scaleY = canvas.height / naturalHeight;

    // Draw each detection bounding box
    imageDetail.detections.forEach((detection, index) => {
      const bbox = detection.bbox;

      // Scale bbox coordinates from natural image size to canvas size
      const x = bbox.x * scaleX;
      const y = bbox.y * scaleY;
      const width = bbox.width * scaleX;
      const height = bbox.height * scaleY;

      // Add padding around bbox
      const bboxPadding = 8;
      const paddedX = x - bboxPadding;
      const paddedY = y - bboxPadding;
      const paddedWidth = width + (bboxPadding * 2);
      const paddedHeight = height + (bboxPadding * 2);

      // Use red color for all boxes
      const color = '#ef4444';

      // Draw corner brackets instead of full rectangle
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';

      const bracketLength = 15;
      const cornerRadius = 4;

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

      // Build label text with detection and top classification
      const detectionLabel = `${detection.category} ${Math.round(detection.confidence * 100)}%`;

      // Get top classification if available
      let classificationLabel = '';
      if (detection.classifications.length > 0) {
        const topClassification = detection.classifications[0];
        classificationLabel = `${topClassification.species} ${Math.round(topClassification.confidence * 100)}%`;
      }

      // Combine labels
      const labels = classificationLabel ? [detectionLabel, classificationLabel] : [detectionLabel];

      ctx.font = 'bold 9px sans-serif';

      // Calculate dimensions for label box
      const labelWidths = labels.map(label => ctx.measureText(label).width);
      const maxLabelWidth = Math.max(...labelWidths);
      const lineHeight = 12;
      const paddingX = 4;
      const paddingY = 3;
      const labelBoxWidth = maxLabelWidth + (paddingX * 2);
      const labelBoxHeight = (labels.length * lineHeight) + (paddingY * 2);
      const margin = 4;
      const borderRadius = 3;

      // Calculate label position - try above box first, but ensure it's not cut off
      let labelY = Math.max(margin, paddedY - labelBoxHeight - margin);

      // If label would be cut off at top, place it below the box instead
      if (labelY < margin) {
        labelY = Math.min(paddedY + paddedHeight + margin, canvas.height - labelBoxHeight - margin);
      }

      // Ensure label doesn't go off right edge
      const labelX = Math.min(paddedX, canvas.width - labelBoxWidth - margin);

      // Draw label background with semi-transparent black and rounded corners
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.roundRect(labelX, labelY, labelBoxWidth, labelBoxHeight, borderRadius);
      ctx.fill();

      // Draw label text
      ctx.fillStyle = 'white';
      labels.forEach((label, idx) => {
        ctx.fillText(label, labelX + paddingX, labelY + paddingY + (idx + 1) * lineHeight - 2);
      });
    });
  }, [imageDetail, imageLoaded, showBboxes]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (imageLoaded) {
        // Trigger redraw by toggling state
        setImageLoaded(false);
        setTimeout(() => setImageLoaded(true), 0);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [imageLoaded]);

  const formatTimestamp = (timestamp: string) => {
    // Handle EXIF format: "2024:12:22 10:30:45" -> "2024-12-22T10:30:45"
    const exifFormatted = timestamp.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const date = new Date(exifFormatted);

    if (isNaN(date.getTime())) {
      return timestamp; // Return original if can't parse
    }

    return date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleDownload = async () => {
    if (!imageRef.current || !imageDetail) return;

    try {
      // Create a temporary canvas to combine image and bboxes
      const downloadCanvas = document.createElement('canvas');
      const ctx = downloadCanvas.getContext('2d');
      if (!ctx) return;

      const img = imageRef.current;

      // Set canvas to natural image size
      downloadCanvas.width = img.naturalWidth;
      downloadCanvas.height = img.naturalHeight;

      // Draw the image
      ctx.drawImage(img, 0, 0);

      // Draw bounding boxes if they're visible
      if (showBboxes && imageDetail.detections.length > 0) {
        imageDetail.detections.forEach((detection) => {
          const bbox = detection.bbox;

          // Use bbox coordinates directly (they're already in natural image size)
          const x = bbox.x;
          const y = bbox.y;
          const width = bbox.width;
          const height = bbox.height;

          // Scale factor for download canvas
          const scaleFactor = downloadCanvas.width / (canvasRef.current?.width || 1);

          // Add padding around bbox (scaled for full resolution)
          const bboxPadding = Math.round(8 * scaleFactor);
          const paddedX = x - bboxPadding;
          const paddedY = y - bboxPadding;
          const paddedWidth = width + (bboxPadding * 2);
          const paddedHeight = height + (bboxPadding * 2);

          // Draw corner brackets instead of full rectangle
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = Math.round(4 * scaleFactor);
          ctx.lineCap = 'round';

          const bracketLength = Math.round(15 * scaleFactor);
          const cornerRadius = Math.round(4 * scaleFactor);

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

          // Build label text
          const detectionLabel = `${detection.category} ${Math.round(detection.confidence * 100)}%`;
          let classificationLabel = '';
          if (detection.classifications.length > 0) {
            const topClassification = detection.classifications[0];
            classificationLabel = `${topClassification.species} ${Math.round(topClassification.confidence * 100)}%`;
          }

          const labels = classificationLabel ? [detectionLabel, classificationLabel] : [detectionLabel];

          // Scale font size for full resolution (scaleFactor already calculated above)
          const fontSize = Math.round(9 * scaleFactor);
          ctx.font = `bold ${fontSize}px sans-serif`;

          // Calculate dimensions for label box
          const labelWidths = labels.map(label => ctx.measureText(label).width);
          const maxLabelWidth = Math.max(...labelWidths);
          const lineHeight = Math.round(12 * scaleFactor);
          const labelPaddingX = Math.round(4 * scaleFactor);
          const labelPaddingY = Math.round(3 * scaleFactor);
          const labelBoxWidth = maxLabelWidth + (labelPaddingX * 2);
          const labelBoxHeight = (labels.length * lineHeight) + (labelPaddingY * 2);
          const margin = Math.round(4 * scaleFactor);
          const borderRadius = Math.round(3 * scaleFactor);

          // Calculate label position - use padded bbox coordinates
          let labelY = Math.max(margin, paddedY - labelBoxHeight - margin);
          if (labelY < margin) {
            labelY = Math.min(paddedY + paddedHeight + margin, downloadCanvas.height - labelBoxHeight - margin);
          }
          const labelX = Math.min(paddedX, downloadCanvas.width - labelBoxWidth - margin);

          // Draw label background with rounded corners
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.beginPath();
          ctx.roundRect(labelX, labelY, labelBoxWidth, labelBoxHeight, borderRadius);
          ctx.fill();

          // Draw label text
          ctx.fillStyle = 'white';
          labels.forEach((label, idx) => {
            ctx.fillText(label, labelX + labelPaddingX, labelY + labelPaddingY + (idx + 1) * lineHeight - 2);
          });
        });
      }

      // Convert canvas to blob and download
      downloadCanvas.toBlob((blob) => {
        if (!blob) return;
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = imageDetail.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }, 'image/jpeg', 0.95);
    } catch (err) {
      console.error('Failed to download image:', err);
    }
  };

  // Group detections by category and classifications by species
  const getDetectionSummary = () => {
    if (!imageDetail) return { detections: '', classifications: '' };

    const categoryCount: Record<string, number> = {};
    const speciesCount: Record<string, number> = {};

    imageDetail.detections.forEach(detection => {
      categoryCount[detection.category] = (categoryCount[detection.category] || 0) + 1;

      detection.classifications.forEach(classification => {
        speciesCount[classification.species] = (speciesCount[classification.species] || 0) + 1;
      });
    });

    const detections = Object.entries(categoryCount)
      .map(([category, count]) => `${category} (${count})`)
      .join(', ');

    const classifications = Object.entries(speciesCount)
      .map(([species, count]) => `${species} (${count})`)
      .join(', ');

    return { detections, classifications };
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <div className="bg-background p-6 rounded-lg shadow-lg max-w-7xl w-full max-h-[90vh] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : imageDetail ? (
          <div className="grid md:grid-cols-3 gap-6">
          {/* Image Display */}
          <div className="md:col-span-2">
            <div className="relative">
              {imageBlobUrl ? (
                <>
                  <img
                    ref={imageRef}
                    src={imageBlobUrl}
                    alt={imageDetail.filename}
                    className="w-full h-auto rounded-lg"
                    onLoad={() => setImageLoaded(true)}
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-full pointer-events-none"
                  />
                </>
              ) : (
                <div className="flex items-center justify-center py-12 bg-muted rounded-lg">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              )}
            </div>
          </div>

          {/* Details Panel */}
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-end justify-end">
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowBboxes(!showBboxes)}
                  className="flex items-center justify-center gap-2"
                >
                  {showBboxes ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showBboxes ? 'Hide' : 'Show'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="flex items-center justify-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPrevious}
                  disabled={!hasPrevious}
                  className="flex items-center justify-center gap-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onNext}
                  disabled={!hasNext}
                  className="flex items-center justify-center gap-2"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Metadata */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <File className="h-4 w-4" />
                  <span>Filename</span>
                </div>
                <p className="text-sm font-mono break-all">{imageDetail.filename}</p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Camera className="h-4 w-4" />
                  <span>Camera</span>
                </div>
                <p className="text-sm">{imageDetail.camera_name}</p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Calendar className="h-4 w-4" />
                  <span>Captured</span>
                </div>
                <p className="text-sm">
                  {imageDetail.image_metadata?.DateTimeOriginal
                    ? formatTimestamp(imageDetail.image_metadata.DateTimeOriginal)
                    : formatTimestamp(imageDetail.uploaded_at)}
                </p>
              </div>

              {(() => {
                const summary = getDetectionSummary();
                return (
                  <>
                    {summary.detections && (
                      <div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                          <Scan className="h-4 w-4" />
                          <span>Detections</span>
                        </div>
                        <p className="text-sm">{summary.detections}</p>
                      </div>
                    )}

                    {summary.classifications && (
                      <div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                          <PawPrint className="h-4 w-4" />
                          <span>Classifications</span>
                        </div>
                        <p className="text-sm">{summary.classifications}</p>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        ) : (
          <div className="py-12 text-center">
            <p className="text-muted-foreground">Image not found</p>
          </div>
        )}
      </div>
    </Dialog>
  );
};
