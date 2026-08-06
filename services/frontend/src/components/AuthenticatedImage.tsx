/**
 * Image component that fetches images with authentication
 *
 * Regular <img> tags can't send Authorization headers, so we fetch
 * the image with credentials and create a blob URL to display it.
 *
 * With `previewSrc` set, both renditions are fetched in parallel and the
 * preview (a small thumbnail) is shown as soon as it arrives, slightly
 * blurred, until the real image replaces it. Both images get the same
 * positioning styles, so the swap never moves the frame.
 */
import React, { useEffect, useState, forwardRef } from 'react';
import apiClient from '../api/client';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  onLoad?: () => void;
  /** Inline style on the <img>. Used by DetectionCrop to position the frame. */
  style?: React.CSSProperties;
  /** Small rendition to show while `src` is still downloading. */
  previewSrc?: string;
}

export const AuthenticatedImage = forwardRef<HTMLImageElement, AuthenticatedImageProps>(
  ({ src, alt, className, fallback, onLoad, style, previewSrc }, ref) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [isPreview, setIsPreview] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

  useEffect(() => {
    const objectUrls: string[] = [];
    let cancelled = false;
    let fullArrived = false;

    setBlobUrl(null);
    setIsPreview(false);
    setLoading(true);
    setError(false);

    // The preview is best-effort: a failure or a late arrival is simply
    // ignored, the real image is the one that decides loading and error.
    const fetchPreview = async () => {
      if (!previewSrc) return;
      try {
        const response = await apiClient.get(previewSrc, { responseType: 'blob' });
        if (cancelled || fullArrived) return;
        const url = URL.createObjectURL(response.data);
        objectUrls.push(url);
        setBlobUrl(url);
        setIsPreview(true);
        setLoading(false);
      } catch {
        // Preview failing is fine; the main image still loads.
      }
    };

    const fetchFull = async () => {
      try {
        const response = await apiClient.get(src, { responseType: 'blob' });
        fullArrived = true;
        if (cancelled) return;
        const url = URL.createObjectURL(response.data);
        objectUrls.push(url);
        setBlobUrl(url);
        setIsPreview(false);
      } catch (err) {
        fullArrived = true;
        if (cancelled) return;
        console.error('Failed to load authenticated image:', err);
        setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (src) {
      fetchPreview();
      fetchFull();
    }

    // Cleanup: revoke blob URLs when component unmounts
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [src, previewSrc]);

  if (loading && !blobUrl) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

    if (error || !blobUrl) {
      return fallback ? (
        <>{fallback}</>
      ) : (
        <div className={`flex items-center justify-center bg-muted ${className}`}>
          <div className="text-muted-foreground text-sm">Failed to load image</div>
        </div>
      );
    }

    return (
      <img
        ref={ref}
        src={blobUrl}
        alt={alt}
        className={className}
        style={isPreview ? { ...style, filter: 'blur(2px)' } : style}
        onLoad={isPreview ? undefined : onLoad}
      />
    );
  }
);

AuthenticatedImage.displayName = 'AuthenticatedImage';
