/**
 * Image detail modal with bounding boxes
 *
 * Keyboard shortcuts:
 * - Enter: Verify and go to next
 * - Escape: Close modal
 * - Left/Right arrows: Navigate images
 * - B: Toggle bounding boxes
 * - 0: Mark as empty and go to next
 * - Tab/Shift+Tab: Cycle focus between observations
 * - Up/Down arrows: Increase/decrease count of focused observation
 * - X: Delete focused observation
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Download, ChevronLeft, ChevronRight, Eye, EyeOff, Heart, Flag, Loader2, Camera, ExternalLink, Sparkles, Sun, Contrast, RotateCcw } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { imagesApi } from '../api/images';
import { drawDetectionOverlay } from '../utils/detection-overlay';
import { VerificationPanel, VerificationPanelRef } from './VerificationPanel';
import { useImageCache } from '../contexts/ImageCacheContext';

interface ImageDetailModalProps {
  imageUuid: string;
  allImageUuids?: string[];  // For look-ahead prefetching
  nextPageFirstUuid?: string | null;  // For cross-page prefetching
  prevPageLastUuid?: string | null;   // For cross-page prefetching
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
  nextPageFirstUuid,
  prevPageLastUuid,
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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [localNotes, setLocalNotes] = useState('');
  const [brightness, setBrightness] = useState(50);
  const [contrast, setContrast] = useState(50);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const adjustRef = useRef<HTMLDivElement>(null);
  const { getImageBlobUrl, getOrFetchImage, prefetchImage } = useImageCache();

  const queryClient = useQueryClient();

  const { data: imageDetail, isLoading, error } = useQuery({
    queryKey: ['image', imageUuid],
    queryFn: () => imagesApi.getByUuid(imageUuid),
    enabled: isOpen && !!imageUuid,
    // Keep showing previous image while loading new one (no loader flash)
    placeholderData: (previousData) => previousData,
  });

  const likeMutation = useMutation({
    mutationFn: (nextLiked: boolean) => imagesApi.setLike(imageUuid, nextLiked),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['image', imageUuid] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
    },
  });

  const needsReviewMutation = useMutation({
    mutationFn: (next: boolean) => imagesApi.setNeedsReview(imageUuid, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['image', imageUuid] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
    },
  });

  // Sync notes from verification panel when image changes
  useEffect(() => {
    if (imageDetail) {
      setLocalNotes(imageDetail.verification.notes || '');
      setNotesExpanded(false);
    }
  }, [imageDetail?.uuid]);

  // Update verification panel when local notes change
  useEffect(() => {
    verificationPanelRef.current?.setNotes(localNotes);
  }, [localNotes]);

  // Close brightness/contrast popover on outside click
  useEffect(() => {
    if (!adjustOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (adjustRef.current && !adjustRef.current.contains(e.target as Node)) {
        setAdjustOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [adjustOpen]);

  // CSS filter for the image. 50 is the neutral identity (1.0x); the slider
  // range 0..100 maps linearly to 0x..2x via /50, mirroring AddaxAI-WebUI.
  const imageFilter =
    brightness !== 50 || contrast !== 50
      ? `brightness(${brightness / 50}) contrast(${contrast / 50})`
      : undefined;

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

    // Same-page prefetching
    if (currentIndex > 0) {
      prefetchImage(`/api/images/${allImageUuids[currentIndex - 1]}/full`);
    }
    if (currentIndex < allImageUuids.length - 1) {
      prefetchImage(`/api/images/${allImageUuids[currentIndex + 1]}/full`);
    }

    // Cross-page prefetching: when at page boundary, prefetch adjacent page's image
    if (currentIndex === allImageUuids.length - 1 && nextPageFirstUuid) {
      prefetchImage(`/api/images/${nextPageFirstUuid}/full`);
    }
    if (currentIndex === 0 && prevPageLastUuid) {
      prefetchImage(`/api/images/${prevPageLastUuid}/full`);
    }
  }, [isOpen, imageUuid, allImageUuids, nextPageFirstUuid, prevPageLastUuid, prefetchImage]);

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

    drawDetectionOverlay(ctx, imageDetail.detections, canvas.width, canvas.height, {
      showLabels: true,
      imageWidth: img.naturalWidth,
      imageHeight: img.naturalHeight,
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
          // Enter: Verify and go to next (or just go to next if already verified)
          e.preventDefault();
          if (!imageDetail) {
            // Image not loaded yet, skip
            return;
          }
          if (imageDetail.verification.is_verified) {
            // Already verified - just go to next
            if (hasNext && onNext) {
              onNext();
            }
          } else {
            // Not verified - save and go to next after save completes
            verificationPanelRef.current?.save(() => {
              if (hasNext && onNext) {
                onNext();
              }
            });
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
        case '0':
          // Verify as empty (no animals) and go to next
          e.preventDefault();
          verificationPanelRef.current?.noAnimals(() => {
            if (hasNext && onNext) {
              onNext();
            }
          });
          break;
        case 'Tab':
          // Cycle focus between observations
          e.preventDefault();
          if (e.shiftKey) {
            verificationPanelRef.current?.focusPrevious();
          } else {
            verificationPanelRef.current?.focusNext();
          }
          break;
        case 'ArrowUp':
          // Increment count of focused observation
          e.preventDefault();
          verificationPanelRef.current?.incrementFocused();
          break;
        case 'ArrowDown':
          // Decrement count of focused observation
          e.preventDefault();
          verificationPanelRef.current?.decrementFocused();
          break;
        case 'x':
        case 'X':
          // Delete focused observation
          e.preventDefault();
          verificationPanelRef.current?.deleteFocused();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onPrevious, onNext, hasPrevious, hasNext, imageDetail, imageUuid]);

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

      if (
        clickX >= x &&
        clickX <= x + width &&
        clickY >= y &&
        clickY <= y + height
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
        drawDetectionOverlay(ctx, imageDetail.detections, downloadCanvas.width, downloadCanvas.height, {
          showLabels: true,
          imageWidth: img.naturalWidth,
          imageHeight: img.naturalHeight,
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
      <div className="bg-background p-6 rounded-lg shadow-lg max-w-7xl w-full max-h-[90vh] overflow-y-auto relative">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : imageDetail ? (
          <>
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
                    style={imageFilter ? { filter: imageFilter } : undefined}
                    onLoad={() => setImageLoaded(true)}
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute top-0 left-0 w-full h-full cursor-pointer"
                    onClick={handleCanvasClick}
                  />
                  {/* AI prediction banner — visible only when bboxes are shown */}
                  {showBboxes && imageDetail.detections.length > 0 && (
                    <div
                      className="absolute top-3 left-1/2 -translate-x-1/2 px-2 py-1 rounded text-xs font-medium text-white flex items-center gap-1 pointer-events-none"
                      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
                    >
                      <Sparkles className="h-3 w-3" />
                      Showing AI predictions
                    </div>
                  )}
                  {/* Camera name chip */}
                  <div
                    className="absolute top-3 right-3 px-2 py-1 rounded text-xs font-medium text-white flex items-center gap-1"
                    style={{ backgroundColor: '#0f6064' }}
                  >
                    <Camera className="h-3 w-3" />
                    {imageDetail.camera_name}
                    {imageDetail.camera_location && (
                      <a
                        href={`https://www.google.com/maps?q=${imageDetail.camera_location.lat},${imageDetail.camera_location.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-0.5 p-0.5 rounded hover:bg-white/20"
                        title="Open in Google Maps"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
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
                  title={showBboxes ? 'Hide AI predictions' : 'Show AI predictions'}
                >
                  {showBboxes ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </Button>
                <div className="relative" ref={adjustRef}>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setAdjustOpen(!adjustOpen)}
                    title={`Brightness: ${brightness}%, contrast: ${contrast}%`}
                  >
                    <Sun className="h-5 w-5" />
                  </Button>
                  {adjustOpen && (
                    <div className="absolute left-0 mt-2 w-56 border rounded-md bg-background shadow-lg z-50 p-3 space-y-3">
                      {/* Brightness */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium flex items-center gap-1">
                            <Sun className="h-3.5 w-3.5" /> Brightness
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {brightness}%
                            </span>
                            {brightness !== 50 && (
                              <button
                                type="button"
                                onClick={() => setBrightness(50)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Reset"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={brightness}
                          onChange={(e) => setBrightness(Number(e.target.value))}
                          className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, #0f6064 0%, #0f6064 ${brightness}%, #e1eceb ${brightness}%, #e1eceb 100%)`,
                          }}
                        />
                      </div>

                      {/* Contrast */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium flex items-center gap-1">
                            <Contrast className="h-3.5 w-3.5" /> Contrast
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {contrast}%
                            </span>
                            {contrast !== 50 && (
                              <button
                                type="button"
                                onClick={() => setContrast(50)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Reset"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={contrast}
                          onChange={(e) => setContrast(Number(e.target.value))}
                          className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, #0f6064 0%, #0f6064 ${contrast}%, #e1eceb ${contrast}%, #e1eceb 100%)`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
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
                  onClick={() => likeMutation.mutate(!imageDetail.is_liked)}
                  disabled={likeMutation.isPending}
                  title={imageDetail.is_liked ? 'Unlike' : 'Like'}
                >
                  <Heart
                    className="h-5 w-5"
                    style={imageDetail.is_liked ? { fill: '#882000', color: '#882000' } : undefined}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => needsReviewMutation.mutate(!imageDetail.needs_review)}
                  disabled={needsReviewMutation.isPending}
                  title={imageDetail.needs_review ? 'Clear review flag' : 'Flag for review'}
                >
                  <Flag
                    className="h-5 w-5"
                    style={imageDetail.needs_review ? { fill: '#71b7ba', color: '#71b7ba' } : undefined}
                  />
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

            {/* Collapsible Notes Section */}
            <div className="mt-3">
              {notesExpanded ? (
                <div className="border border-input rounded-md p-3 bg-background">
                  <textarea
                    value={localNotes}
                    onChange={(e) => setLocalNotes(e.target.value)}
                    placeholder="Add notes about this image..."
                    className="w-full h-20 px-2 py-1.5 text-sm border-0 bg-transparent resize-none focus:outline-none"
                    autoFocus
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        verificationPanelRef.current?.saveNotes();
                        setNotesExpanded(false);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : localNotes ? (
                <button
                  onClick={() => setNotesExpanded(true)}
                  className="w-full text-left p-2 rounded-md border border-input bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <p className="text-xs text-muted-foreground mb-0.5">Notes</p>
                  <p className="text-sm line-clamp-2">{localNotes}</p>
                </button>
              ) : (
                <button
                  onClick={() => setNotesExpanded(true)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  + Add notes
                </button>
              )}
            </div>

          </div>
        </div>

        {/* Keyboard shortcuts link - anchored bottom right */}
        <div className="absolute bottom-4 right-4">
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Show keyboard shortcuts
          </button>
          {showShortcuts && (
            <div className="absolute bottom-6 right-0 bg-background border border-border rounded-md shadow-lg p-3 z-50 min-w-[180px]">
              <div className="text-xs space-y-1">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Enter</span>
                  <span>Verify + next</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">0</span>
                  <span>Empty + next</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">← →</span>
                  <span>Navigate</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Tab</span>
                  <span>Next observation</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">⇧Tab</span>
                  <span>Prev observation</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">↑ ↓</span>
                  <span>Change count</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">X</span>
                  <span>Delete observation</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">B</span>
                  <span>Toggle AI predictions</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Esc</span>
                  <span>Close</span>
                </div>
              </div>
            </div>
          )}
        </div>
        </>
        ) : (
          <div className="py-12 text-center">
            <p className="text-muted-foreground">Image not found</p>
          </div>
        )}
      </div>
    </Dialog>
  );
};
