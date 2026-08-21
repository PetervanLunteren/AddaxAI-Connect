/**
 * Image detail modal with bounding boxes
 *
 * Keyboard shortcuts:
 * - Enter: Verify and go to next
 * - Escape: Close modal
 * - Left/Right arrows: Navigate images
 * - B: Toggle bounding boxes
 * - 0: Mark as empty and go to next (while the form has no observations)
 * - 1-9: Type the focused observation's count (multi-digit within 700ms)
 * - Q/W/E: Species shortcut slots, assigned in the shortcuts popover,
 *   stored per user per project in localStorage
 * - Up/Down arrows: Move focus between observations (Tab/Shift+Tab alias)
 * - Plus/Minus: Increase/decrease count of focused observation
 * - X: Delete focused observation
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Download, Share2, ChevronLeft, ChevronRight, ChevronDown, Eye, EyeOff, Heart, Flag, Loader2, MapPin, ExternalLink, Sparkles, Sun, Contrast, RotateCcw, Plus, Minus, Maximize2, Shield, ShieldOff, Clock, Camera as CameraIcon } from 'lucide-react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { useNavigate } from 'react-router-dom';

type SlotKey = 'q' | 'w' | 'e';
const SLOT_KEYS: SlotKey[] = ['q', 'w', 'e'];
// Fast typing of e.g. 1 then 2 sets the count to 12; after this pause the
// next digit starts a fresh number. Mirrors AddaxAI's event count panel.
const DIGIT_WINDOW_MS = 700;
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { useToast } from './ui/Toaster';
import { imagesApi } from '../api/images';
import { drawDetectionOverlay } from '../utils/detection-overlay';
import { VerificationPanel, VerificationPanelRef } from './VerificationPanel';
import { useImageCache } from '../contexts/ImageCacheContext';
import { useProject } from '../contexts/ProjectContext';
import { normalizeLabel } from '../utils/labels';
import { formatDate, formatDateTime } from '../utils/datetime';
import { TagInput } from './TagInput';

// Pipeline stage in words the reader can act on. The raw values come from
// the workers ("classified", "detected") and mean nothing outside the code.
const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting to be processed',
  processing: 'Looking for animals',
  detected: 'Waiting for species',
  classifying: 'Identifying species',
  classified: 'Done',
  failed: 'Processing failed',
};

const LIGHT_LABELS: Record<string, string> = {
  day: 'Day',
  night: 'Night',
};

/**
 * One label and value line in the Details section. Renders nothing when the
 * value is empty, so a field we cannot fill leaves no blank row behind.
 */
const DetailRow: React.FC<{ label: string; children?: React.ReactNode }> = ({ label, children }) => {
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <div className="flex gap-3 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
};

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
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [showBboxes, setShowBboxes] = useState(true);
  // Admin-only unblur for identification cases. Deliberately resets to
  // blurred on every image change, unblurring is a conscious per-image act.
  const [showUnblurred, setShowUnblurred] = useState(false);
  // Species shortcut slots (Q, W, E), assigned in the shortcuts popover and
  // stored per user per project in localStorage
  const [speciesSlots, setSpeciesSlots] = useState<Record<SlotKey, string>>({ q: '', w: '', e: '' });
  const speciesSlotsRef = useRef(speciesSlots);
  speciesSlotsRef.current = speciesSlots;
  // Multi-digit count entry (typing 1 then 2 quickly sets the count to 12)
  const digitBufferRef = useRef<string>('');
  const digitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedSpecies, setHighlightedSpecies] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  // Details and raw EXIF stay folded per image on purpose. Opening them once
  // should not turn every following photo into a wall of text.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [exifExpanded, setExifExpanded] = useState(false);
  const [localNotes, setLocalNotes] = useState('');
  const [brightness, setBrightness] = useState(50);
  const [contrast, setContrast] = useState(50);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const adjustRef = useRef<HTMLDivElement>(null);
  const { getImageBlobUrl, getOrFetchImage, prefetchImage } = useImageCache();
  const { isProjectAdmin, selectedProject } = useProject();
  const toast = useToast();
  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const { data: imageDetail, isLoading } = useQuery({
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

  const tagsMutation = useMutation({
    mutationFn: (tags: string[]) => imagesApi.setTags(imageUuid, tags),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['image', imageUuid] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['image-tags'] });
    },
  });

  // Autocomplete suggestions for the tag input, the project's vocabulary
  const { data: imageTagSuggestions } = useQuery({
    queryKey: ['image-tags', selectedProject?.id],
    queryFn: () => imagesApi.getTags(selectedProject?.id),
    enabled: isOpen && selectedProject?.id !== undefined,
  });

  // Sync notes from verification panel when image changes
  useEffect(() => {
    if (imageDetail) {
      setLocalNotes(imageDetail.verification.notes || '');
      setNotesExpanded(false);
      setDetailsExpanded(false);
      setExifExpanded(false);
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

  // Reset on image change only, not on URL change, or toggling the blur
  // would immediately reset itself
  useEffect(() => {
    setShowUnblurred(false);
    digitBufferRef.current = '';
  }, [imageUuid]);

  // Load the species slots for the current project
  const slotsStorageKey = `addaxai-connect:speciesSlots:${selectedProject?.id ?? 0}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(slotsStorageKey) || '{}');
      setSpeciesSlots({ q: saved.q || '', w: saved.w || '', e: saved.e || '' });
    } catch {
      setSpeciesSlots({ q: '', w: '', e: '' });
    }
  }, [slotsStorageKey]);
  const updateSlot = (key: SlotKey, value: string) => {
    setSpeciesSlots((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(slotsStorageKey, JSON.stringify(next));
      return next;
    });
  };

  // Species options for the slot pickers, same cached query the filter uses
  const { data: slotSpeciesOptions } = useQuery({
    queryKey: ['species', selectedProject?.id],
    queryFn: () => imagesApi.getSpecies(selectedProject?.id),
    enabled: isOpen && selectedProject?.id !== undefined,
  });

  // Construct URL directly from UUID - don't wait for imageDetail
  const fullImageUrl = `/api/images/${imageUuid}/full${showUnblurred ? '?unblurred=true' : ''}`;

  // Blur-up: show the small thumbnail while the full image downloads, so
  // the modal keeps its proportions instead of collapsing to a spinner.
  // Thumbnails preserve the aspect ratio, so the layout box matches the
  // full image exactly. The browser HTTP cache usually still holds the
  // thumbnail from the grid, making this fetch effectively free.
  const thumbnailUrl = `/api/images/${imageUuid}/thumbnail`;
  const [thumbnailBlobUrl, setThumbnailBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen || !imageUuid) return;
    const cached = getImageBlobUrl(thumbnailUrl);
    if (cached) {
      setThumbnailBlobUrl(cached);
      return;
    }
    setThumbnailBlobUrl(null);
    let cancelled = false;
    getOrFetchImage(thumbnailUrl)
      .then((blobUrl) => {
        if (!cancelled) setThumbnailBlobUrl(blobUrl);
      })
      .catch(() => {
        // No thumbnail is not an error, the spinner fallback covers it
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, imageUuid, thumbnailUrl, getImageBlobUrl, getOrFetchImage]);

  // Fetch authenticated image using the shared cache
  // Check synchronously first to avoid loader flash for cached images
  useEffect(() => {
    if (!isOpen || !imageUuid) return;

    // Reset the loaded flag on every image change so the bbox draw effect
    // reruns when the new <img> finishes loading. Without this the flag
    // stays true across cached-image navigation and onLoad becomes a no-op,
    // leaving the canvas blank or with stale dimensions even though the
    // "Showing AI predictions" chip is visible.
    setImageLoaded(false);
    transformRef.current?.resetTransform(0);

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

    // Back the canvas with physical pixels, otherwise boxes and labels
    // render at CSS resolution and look blurry on retina screens. The
    // CSS size stays the image box (w-full h-full classes), drawing
    // keeps using CSS coordinates via the transform.
    const rect = img.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // If bboxes are hidden, just clear and return
    if (!showBboxes) return;

    drawDetectionOverlay(ctx, imageDetail.detections, rect.width, rect.height, {
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        // Allow Escape even in inputs
        if (e.key !== 'Escape') return;
      }

      // Species shortcut slots. Sets the focused observation's species, or
      // adds a first observation of that species on an empty form.
      const lower = e.key.toLowerCase();
      if (SLOT_KEYS.includes(lower as SlotKey) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const value = speciesSlotsRef.current[lower as SlotKey];
        if (value) {
          e.preventDefault();
          verificationPanelRef.current?.applySpeciesToFocused({
            value,
            label: normalizeLabel(value),
          });
          return;
        }
      }

      // Digits type the focused observation's count, multi-digit within the
      // window. 0 keeps meaning "empty + next" while the form has no rows.
      if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const hasRows = verificationPanelRef.current?.hasObservations() ?? false;
        const bufferOpen = digitBufferRef.current.length > 0;
        if (e.key === '0' && !bufferOpen && !hasRows) {
          e.preventDefault();
          verificationPanelRef.current?.noAnimals(() => {
            if (hasNext && onNext) {
              onNext();
            }
          });
          return;
        }
        if (hasRows) {
          e.preventDefault();
          // Cap at 4 digits (9999) so a key-mash cannot request an absurd count
          const digits = (digitBufferRef.current + e.key).slice(0, 4);
          digitBufferRef.current = digits;
          if (digitTimerRef.current) clearTimeout(digitTimerRef.current);
          digitTimerRef.current = setTimeout(() => {
            digitBufferRef.current = '';
          }, DIGIT_WINDOW_MS);
          verificationPanelRef.current?.setCountFocused(Number(digits));
          return;
        }
        return;
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
          // Move to the previous observation (arrows navigate the list,
          // like AddaxAI's count panel; Tab stays as a quiet alias)
          e.preventDefault();
          verificationPanelRef.current?.focusPrevious();
          break;
        case 'ArrowDown':
          // Move to the next observation
          e.preventDefault();
          verificationPanelRef.current?.focusNext();
          break;
        case '+':
        case '=':
          // Nudge the focused observation's count up, mirroring the row's
          // plus button ('=' is the unshifted + on most layouts)
          e.preventDefault();
          digitBufferRef.current = '';
          verificationPanelRef.current?.incrementFocused();
          break;
        case '-':
          // Nudge the focused observation's count down
          e.preventDefault();
          digitBufferRef.current = '';
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
    // Use rect dimensions (post-transform) rather than canvas bitmap so
    // click coordinates stay aligned with the displayed bboxes when the
    // user has zoomed in via TransformWrapper.
    const scaleX = rect.width / img.naturalWidth;
    const scaleY = rect.height / img.naturalHeight;

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

  // Link to the images page whichever surface opened the modal, so there is
  // one shareable address per image. The receiver needs an account and access
  // to the project, the API checks both.
  const shareUrl = selectedProject
    ? `${window.location.origin}/projects/${selectedProject.id}/images?image=${imageUuid}`
    : null;

  const handleShare = async () => {
    if (!shareUrl) return;
    // Touch devices open the system share sheet, which is the WhatsApp case.
    // Desktops copy instead. The pointer check is needed because desktop
    // Chrome also has navigator.share, and its sheet offers Mail and AirDrop
    // but no way to paste the link into Slack. Without the check the same
    // laptop would behave differently in Chrome than in Firefox.
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ url: shareUrl });
      } catch {
        // Cancelling the sheet throws, and a cancel is not an error. No
        // fallback copy either, that would claim success for something the
        // user backed out of.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  // Jump from the photo to the camera that took it. Closes the modal, because
  // the cameras page opens the detail sheet on arrival and two stacked
  // overlays would trap the escape key.
  const openCamera = () => {
    if (!selectedProject || !imageDetail) return;
    onClose();
    navigate(`/projects/${selectedProject.id}/cameras?camera=${imageDetail.camera_id}`);
  };

  // "3, 12 Apr 2026 to now". Same phrasing as the deployment history on the
  // camera sheet, so one period reads the same wherever you meet it.
  const deployment = imageDetail?.deployment;
  const deploymentText = deployment
    ? `${deployment.number}, ${formatDate(deployment.start_date)} to ${
        deployment.end_date ? formatDate(deployment.end_date) : 'now'
      }`
    : null;

  const width = imageDetail?.image_metadata?.width;
  const height = imageDetail?.image_metadata?.height;
  const pixelSize = width && height ? `${width} × ${height}` : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {/* Below md the modal is a fixed column: the photo stays fully
          visible and only the details panel scrolls. On md+ the whole
          modal scrolls as before. */}
      {/* The height cap is viewport-based (dvh minus the iOS status-bar
          inset), the parent wrapper has auto height so max-h-full would
          resolve to no cap at all. */}
      <div className="bg-background p-3 sm:p-6 rounded-lg shadow-lg w-[calc(100vw-1rem)] sm:w-full sm:max-w-7xl max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_1rem)] sm:max-h-[90vh] flex flex-col overflow-hidden md:block md:overflow-y-auto overflow-x-hidden relative">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : imageDetail ? (
          <>
          <div className="flex min-h-0 flex-col gap-4 md:grid md:grid-cols-3 md:gap-6">
          {/* Image Display */}
          <div className="md:col-span-2 min-w-0 shrink-0">
            <div className="relative">
              {imageBlobUrl ? (
                <>
                  <TransformWrapper
                    ref={transformRef}
                    minScale={1}
                    maxScale={5}
                    initialScale={1}
                    doubleClick={{ mode: 'reset' }}
                    wheel={{ step: 0.2 }}
                    panning={{ velocityDisabled: true }}
                  >
                    <TransformComponent
                      wrapperStyle={{ width: '100%', borderRadius: '0.5rem' }}
                      contentStyle={{ width: '100%' }}
                    >
                      <div className="relative w-full">
                        <img
                          ref={imageRef}
                          src={imageBlobUrl}
                          alt={imageDetail.filename}
                          className="block w-full max-w-full h-auto rounded-lg"
                          style={imageFilter ? { filter: imageFilter } : undefined}
                          onLoad={() => setImageLoaded(true)}
                          draggable={false}
                        />
                        <canvas
                          ref={canvasRef}
                          className="absolute top-0 left-0 w-full h-full cursor-pointer"
                          onClick={handleCanvasClick}
                        />
                      </div>
                    </TransformComponent>
                  </TransformWrapper>
                  {/* AI prediction banner — visible only when bboxes are shown */}
                  {showBboxes && imageDetail.detections.length > 0 && (
                    <div
                      className="hidden sm:flex absolute top-3 left-1/2 -translate-x-1/2 px-2 py-1 rounded text-xs font-medium text-white items-center gap-1 pointer-events-none"
                      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
                    >
                      <Sparkles className="h-3 w-3" />
                      Showing AI predictions
                    </div>
                  )}
                  {/* Site chip (the primary "where"), top-left. The location
                      belongs to the site, so the maps link lives here. */}
                  {imageDetail.site && (
                    <div
                      className="absolute top-3 left-3 px-2 py-1 rounded text-xs font-medium text-white flex items-center gap-1"
                      style={{ backgroundColor: '#0f6064' }}
                    >
                      <MapPin className="h-3 w-3" />
                      {imageDetail.site.name}
                      <a
                        href={`https://www.google.com/maps?q=${imageDetail.site.lat},${imageDetail.site.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-0.5 p-0.5 rounded hover:bg-white/20"
                        title="Open in Google Maps"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                  {/* Zoom controls. Hidden on touch screens, where pinch and
                      double-tap zoom already work and the buttons only sit on
                      top of the photo. */}
                  <div
                    className="absolute bottom-3 right-3 flex items-center gap-0.5 px-1 py-1 rounded text-white [@media(pointer:coarse)]:hidden"
                    style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
                  >
                    <button
                      type="button"
                      onClick={() => transformRef.current?.zoomOut()}
                      className="p-1 rounded hover:bg-white/20"
                      title="Zoom out"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => transformRef.current?.resetTransform()}
                      className="p-1 rounded hover:bg-white/20"
                      title="Fit to screen"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => transformRef.current?.zoomIn()}
                      className="p-1 rounded hover:bg-white/20"
                      title="Zoom in"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </>
              ) : thumbnailBlobUrl ? (
                // Blur-up placeholder, same width classes as the real image
                // so the modal proportions never jump on load
                <div className="relative w-full overflow-hidden rounded-lg">
                  <img
                    src={thumbnailBlobUrl}
                    alt={imageDetail.filename}
                    className="block w-full max-w-full h-auto rounded-lg blur-sm"
                    draggable={false}
                  />
                  <div className="absolute bottom-3 right-3">
                    <Loader2 className="h-5 w-5 animate-spin text-white drop-shadow" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 bg-muted rounded-lg">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              )}
            </div>
          </div>

          {/* Details Panel. Scrolls on its own below md, see the modal
              container comment. */}
          <div className="space-y-4 min-w-0 min-h-0 flex-1 overflow-y-auto md:overflow-visible">
            {/* Header with action buttons, pinned while the panel scrolls
                on phones */}
            <div className="flex items-center justify-between gap-1 sticky top-0 z-10 bg-background md:static">
              {/* Wraps because the row runs out of width at 390px: eight
                  40px buttons plus the close button need 392px and the
                  panel has 350px. Without wrapping flexbox shrinks the
                  buttons instead, which nothing flags and which makes the
                  tap targets worse. */}
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowBboxes(!showBboxes)}
                  title={showBboxes ? 'Hide AI predictions' : 'Show AI predictions'}
                >
                  {showBboxes ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </Button>
                {/* Admin-only unblur for identification cases (theft,
                    infractions). Shown only when this image has a detection
                    of a category the project actually blurs. The server
                    enforces the permission, this button is convenience. */}
                {isProjectAdmin &&
                  imageDetail?.detections.some(
                    (d) =>
                      (d.category === 'person' && selectedProject?.blur_people) ||
                      (d.category === 'vehicle' && selectedProject?.blur_vehicles),
                  ) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowUnblurred(!showUnblurred)}
                      title={showUnblurred ? 'Restore privacy blur' : 'Show without privacy blur'}
                    >
                      {showUnblurred ? (
                        <ShieldOff className="h-5 w-5 text-red-600" />
                      ) : (
                        <Shield className="h-5 w-5" />
                      )}
                    </Button>
                  )}
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
                {shareUrl && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleShare}
                    title="Share this image"
                  >
                    <Share2 className="h-5 w-5" />
                  </Button>
                )}
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

            {/* When and which camera. Always visible, never behind the
                expander: these are the two facts you need on every single
                photo, and the site chip on the image only answers "where". */}
            <div className="space-y-1 pb-3 border-b">
              <p className="text-sm flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {formatDateTime(imageDetail.captured_at)}
              </p>
              <button
                type="button"
                onClick={openCamera}
                className="text-sm flex items-center gap-1.5 min-w-0 hover:text-primary transition-colors"
                title="Open this camera"
              >
                <CameraIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{imageDetail.camera_name}</span>
              </button>
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

            {/* Image tags, user-assigned flags for events of interest.
                Each add or remove saves immediately, like the heart and
                flag buttons, there is no draft state for chips. */}
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-1">Tags</p>
              <TagInput
                value={imageDetail.tags}
                onChange={(tags) => tagsMutation.mutate(tags)}
                suggestions={imageTagSuggestions ?? []}
                disabled={tagsMutation.isPending}
                placeholder='For example "predation event" or "injured animal"'
              />
            </div>

            {/* Everything else about this photo, folded away by default so
                it never competes with the verification form. */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setDetailsExpanded(!detailsExpanded)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {detailsExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Details
              </button>
              {detailsExpanded && (
                <div className="mt-2 space-y-1.5">
                  <DetailRow label="Site">
                    {imageDetail.site && (
                      <a
                        href={`https://www.google.com/maps?q=${imageDetail.site.lat},${imageDetail.site.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:text-primary"
                      >
                        {imageDetail.site.name} ({imageDetail.site.lat.toFixed(5)}, {imageDetail.site.lon.toFixed(5)})
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    )}
                  </DetailRow>
                  <DetailRow label="Deployment">{deploymentText}</DetailRow>
                  <DetailRow label="Received">{formatDateTime(imageDetail.ingested_at)}</DetailRow>
                  <DetailRow label="Source">
                    {imageDetail.origin === 'bulk' ? 'Bulk upload' : 'Live camera'}
                  </DetailRow>
                  <DetailRow label="Light">{LIGHT_LABELS[imageDetail.day_night ?? '']}</DetailRow>
                  <DetailRow label="Camera model">{imageDetail.camera_model}</DetailRow>
                  <DetailRow label="File">{imageDetail.filename}</DetailRow>
                  <DetailRow label="Size">{pixelSize}</DetailRow>
                  <DetailRow label="Status">
                    {STATUS_LABELS[imageDetail.status] ?? imageDetail.status}
                  </DetailRow>
                  {Object.keys(imageDetail.image_metadata).length > 0 && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setExifExpanded(!exifExpanded)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {exifExpanded ? 'Hide raw EXIF' : 'Show raw EXIF'}
                      </button>
                      {exifExpanded && (
                        <pre className="mt-1 p-2 rounded bg-muted text-[11px] overflow-x-auto">
                          {JSON.stringify(imageDetail.image_metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Keyboard shortcuts link - anchored bottom right, hidden on touch screens */}
        <div className="hidden sm:block absolute bottom-4 right-4">
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Show shortcuts
          </button>
          {showShortcuts && (
            <div className="absolute bottom-6 right-0 bg-background border border-border rounded-md shadow-lg p-3 z-50 min-w-[230px]">
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
                  <span className="text-muted-foreground">1-9</span>
                  <span>Type the count</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">← →</span>
                  <span>Navigate</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">↑ ↓</span>
                  <span>Move between observations</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">+ -</span>
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
                  <span className="text-muted-foreground">Scroll</span>
                  <span>Zoom</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Esc</span>
                  <span>Close</span>
                </div>
                {/* Species shortcut slots, per user per project */}
                <div className="border-t my-2" />
                <div className="text-muted-foreground">Species keys, set the focused observation to</div>
                {SLOT_KEYS.map((slotKey) => (
                  <div key={slotKey} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground uppercase">{slotKey}</span>
                    <select
                      className="border border-input rounded bg-background text-xs px-1 py-0.5 max-w-[160px]"
                      value={speciesSlots[slotKey]}
                      onChange={(ev) => updateSlot(slotKey, ev.target.value)}
                    >
                      <option value="">Not set</option>
                      {(slotSpeciesOptions ?? [])
                        .filter((o) => String(o.value) !== 'empty')
                        .map((o) => (
                          <option key={String(o.value)} value={String(o.value)}>
                            {String(o.label)}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </>
        ) : (
          // Reachable from a shared link to an image that was deleted, or
          // that the reader may not see. Needs its own close button, the
          // whole toolbar above is gone in this branch.
          <div className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">Image not found</p>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Dialog>
  );
};
