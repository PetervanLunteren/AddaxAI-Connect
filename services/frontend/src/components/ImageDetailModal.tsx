/**
 * Image detail modal with bounding boxes
 */
import React, { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Calendar, Camera, Download, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2 } from 'lucide-react';
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

      // Use consistent color for all boxes
      const color = '#0f6064';

      // Draw rectangle
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);

      // Draw label background
      const label = detection.category;
      const confidence = Math.round(detection.confidence * 100);
      const text = `${label} ${confidence}%`;

      ctx.font = 'bold 14px sans-serif';
      const textMetrics = ctx.measureText(text);
      const textWidth = textMetrics.width;
      const textHeight = 20;

      ctx.fillStyle = color;
      ctx.fillRect(x, y - textHeight - 4, textWidth + 8, textHeight + 4);

      // Draw label text
      ctx.fillStyle = 'white';
      ctx.fillText(text, x + 4, y - 8);
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
    const date = new Date(timestamp);
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
    if (!imageBlobUrl || !imageDetail) return;

    try {
      const response = await fetch(imageBlobUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = imageDetail.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
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
            <div className="flex items-start justify-between">
              <h2 className="text-xl font-bold">Image Details</h2>
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
                <div className="text-sm text-muted-foreground mb-1">Filename</div>
                <p className="text-sm font-mono break-all">{imageDetail.filename}</p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Camera className="h-4 w-4" />
                  <span>Camera</span>
                </div>
                <p className="font-medium">{imageDetail.camera_name}</p>
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
                        <div className="text-sm text-muted-foreground mb-1">Detections</div>
                        <p className="text-sm">{summary.detections}</p>
                      </div>
                    )}

                    {summary.classifications && (
                      <div>
                        <div className="text-sm text-muted-foreground mb-1">Classifications</div>
                        <p className="text-sm">{summary.classifications}</p>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Detections */}
            <div>
              <h3 className="font-semibold mb-3">
                Detections ({imageDetail.detections.length})
              </h3>
              {imageDetail.detections.length > 0 ? (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {imageDetail.detections.map((detection, index) => {
                    const color = '#0f6064';

                    return (
                      <div
                        key={detection.id}
                        className="p-3 border rounded-lg"
                        style={{ borderColor: color, borderWidth: 1 }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{detection.category}</span>
                          <span className="text-sm text-muted-foreground">
                            {Math.round(detection.confidence * 100)}%
                          </span>
                        </div>

                        {/* Classifications */}
                        {detection.classifications.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground mb-1">
                              Species Classifications:
                            </div>
                            {detection.classifications.map((classification) => (
                              <div
                                key={classification.id}
                                className="flex items-center justify-between text-sm bg-muted px-2 py-1 rounded"
                              >
                                <span className="font-medium text-primary">
                                  {classification.species}
                                </span>
                                <span className="text-xs">
                                  {Math.round(classification.confidence * 100)}%
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Bounding Box Info */}
                        <div className="mt-2 text-xs text-muted-foreground">
                          BBox: [{Math.round(detection.bbox.x)}, {Math.round(detection.bbox.y)},{' '}
                          {Math.round(detection.bbox.width)}x{Math.round(detection.bbox.height)}]
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No detections found</p>
              )}
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
