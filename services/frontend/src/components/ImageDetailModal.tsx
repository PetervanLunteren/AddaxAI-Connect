/**
 * Image detail modal with bounding boxes
 *
 * Keyboard shortcuts:
 * - Enter: Save observations
 * - Escape: Close modal
 * - Left/Right arrows: Navigate images
 * - B: Toggle bounding boxes
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Download, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, Camera, Keyboard } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { imagesApi } from '../api/images';
import { normalizeLabel } from '../utils/labels';
import { VerificationPanel, VerificationPanelRef } from './VerificationPanel';
import { useImageCache } from '../contexts/ImageCacheContext';

interface ImageDetailModalProps {
  imageUuid: string;
  allImageUuids?: string[];  // For look-ahead prefetching
  isOpen: boolean;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

export const ImageDetailModal: React.FC<ImageDetailModalProps> = ({
  imageUuid,
  allImageUuids,
  isOpen,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const verificationPanelRef = useRef<VerificationPanelRef>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [showBboxes, setShowBboxes] = useState(true);
  const [highlightedSpecies, setHighlightedSpecies] = useState<string | null>(null);
  const { getImageBlobUrl, getOrFetchImage, prefetchImage } = useImageCache();

  const { data: imageDetail, isLoading, error } = useQuery({
    queryKey: ['image', imageUuid],
    queryFn: () => imagesApi.getByUuid(imageUuid),
    enabled: isOpen && !!imageUuid,
    // Keep showing previous image while loading new one (no loader flash)
    placeholderData: (previousData) => previousData,
  });

  // Construct URL directly from UUID - don't wait for imageDetail
  const fullImageUrl = `/api/images/${imageUuid}/full`;

  // Fetch authenticated image using the shared cache
  // Check synchronously first to avoid loader flash for cached images
  useEffect(() => {
    if (!isOpen || !imageUuid) return;

    // Check cache SYNCHRONOUSLY first - this prevents the loader flash
    const cachedUrl = getImageBlobUrl(fullImageUrl);
    if (cachedUrl) {
      setImageBlobUrl(cachedUrl);
      return; // No cleanup needed for cached images
    }

    // Not in cache - need to fetch (show loader)
    let cancelled = false;
    setImageBlobUrl(null);

    getOrFetchImage(fullImageUrl)
      .then((blobUrl) => {
        if (!cancelled) {
          setImageBlobUrl(blobUrl);
        }
      })
      .catch((err) => {
        console.error('Failed to load full image:', err);
      });

    return () => {
      cancelled = true;
      setImageLoaded(false);
    };
  }, [isOpen, imageUuid, fullImageUrl, getImageBlobUrl, getOrFetchImage]);

  // Prefetch adjacent images for smooth navigation
  useEffect(() => {
    if (!isOpen || !imageUuid || !allImageUuids) return;

    const currentIndex = allImageUuids.indexOf(imageUuid);
    if (currentIndex === -1) return;

    // Prefetch previous and next images
    if (currentIndex > 0) {
      prefetchImage(`/api/images/${allImageUuids[currentIndex - 1]}/full`);
    }
    if (currentIndex < allImageUuids.length - 1) {
      prefetchImage(`/api/images/${allImageUuids[currentIndex + 1]}/full`);
    }
  }, [isOpen, imageUuid, allImageUuids, prefetchImage]);

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
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';

      const bracketLength = 12;
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
      const detectionLabel = `${normalizeLabel(detection.category)} ${Math.round(detection.confidence * 100)}%`;

      // Get top classification if available
      let classificationLabel = '';
      if (detection.classifications.length > 0) {
        const topClassification = detection.classifications[0];
        classificationLabel = `${normalizeLabel(topClassification.species)} ${Math.round(topClassification.confidence * 100)}%`;
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

      // Draw label text (vertically centered)
      ctx.fillStyle = 'white';
      ctx.textBaseline = 'middle';
      labels.forEach((label, idx) => {
        // Calculate Y position: start from labelY, offset by paddingY, then center in each line
        const textY = labelY + paddingY + (idx + 0.5) * lineHeight;
        ctx.fillText(label, labelX + paddingX, textY);
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

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Allow Escape even in inputs
        if (e.key !== 'Escape') return;
      }

      switch (e.key) {
        case 'Enter':
          // Save observations (Ctrl/Cmd+Enter or just Enter when not in input)
          if (!target.tagName || target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            verificationPanelRef.current?.save();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowLeft':
          if (hasPrevious && onPrevious) {
            e.preventDefault();
            onPrevious();
          }
          break;
        case 'ArrowRight':
          if (hasNext && onNext) {
            e.preventDefault();
            onNext();
          }
          break;
        case 'b':
        case 'B':
          // Toggle bounding boxes
          e.preventDefault();
          setShowBboxes(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onPrevious, onNext, hasPrevious, hasNext]);

  // Handle bbox click to highlight species row
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageDetail || !canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const img = imageRef.current;
    const scaleX = canvas.width / img.naturalWidth;
    const scaleY = canvas.height / img.naturalHeight;

    // Check if click is inside any detection bbox
    for (const detection of imageDetail.detections) {
      const bbox = detection.bbox;
      const x = bbox.x * scaleX;
      const y = bbox.y * scaleY;
      const width = bbox.width * scaleX;
      const height = bbox.height * scaleY;

      // Add padding like we do when drawing
      const bboxPadding = 8;
      const paddedX = x - bboxPadding;
      const paddedY = y - bboxPadding;
      const paddedWidth = width + (bboxPadding * 2);
      const paddedHeight = height + (bboxPadding * 2);

      if (
        clickX >= paddedX &&
        clickX <= paddedX + paddedWidth &&
        clickY >= paddedY &&
        clickY <= paddedY + paddedHeight
      ) {
        // Found a matching bbox - get the species from top classification
        if (detection.classifications.length > 0) {
          const species = detection.classifications[0].species;
          setHighlightedSpecies(species);
          // Clear after a moment to allow re-clicking same bbox
          setTimeout(() => setHighlightedSpecies(null), 100);
        }
        break;
      }
    }
  }, [imageDetail]);

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

          const bracketLength = Math.round(12 * scaleFactor);
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
          const detectionLabel = `${normalizeLabel(detection.category)} ${Math.round(detection.confidence * 100)}%`;
          let classificationLabel = '';
          if (detection.classifications.length > 0) {
            const topClassification = detection.classifications[0];
            classificationLabel = `${normalizeLabel(topClassification.species)} ${Math.round(topClassification.confidence * 100)}%`;
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

          // Draw label text (vertically centered)
          ctx.fillStyle = 'white';
          ctx.textBaseline = 'middle';
          labels.forEach((label, idx) => {
            // Calculate Y position: start from labelY, offset by paddingY, then center in each line
            const textY = labelY + labelPaddingY + (idx + 0.5) * lineHeight;
            ctx.fillText(label, labelX + labelPaddingX, textY);
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
                    className="absolute top-0 left-0 w-full h-full cursor-pointer"
                    onClick={handleCanvasClick}
                  />
                  {/* Camera name chip */}
                  <div
                    className="absolute top-3 right-3 px-2 py-1 rounded text-xs font-medium text-white flex items-center gap-1"
                    style={{ backgroundColor: '#0f6064' }}
                  >
                    <Camera className="h-3 w-3" />
                    {imageDetail.camera_name}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-12 bg-muted rounded-lg">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              )}
            </div>
          </div>

          {/* Details Panel */}
          <div className="space-y-4">
            {/* Header with action buttons */}
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowBboxes(!showBboxes)}
                  title={showBboxes ? 'Hide boxes' : 'Show boxes'}
                >
                  {showBboxes ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDownload}
                  title="Download image"
                >
                  <Download className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={`Keyboard shortcuts:\nEnter - Save\nEsc - Close\n← → - Navigate\nB - Toggle boxes`}
                  className="cursor-help"
                >
                  <Keyboard className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onPrevious}
                  disabled={!hasPrevious}
                  title="Previous image"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onNext}
                  disabled={!hasNext}
                  title="Next image"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} title="Close">
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Verification Panel */}
            <VerificationPanel
              ref={verificationPanelRef}
              imageUuid={imageUuid}
              imageDetail={imageDetail}
              highlightedSpecies={highlightedSpecies}
            />
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
