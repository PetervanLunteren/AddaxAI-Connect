/**
 * Image component that fetches images with authentication
 *
 * Regular <img> tags can't send Authorization headers, so we fetch
 * the image with credentials and create a blob URL to display it.
 */
import React, { useEffect, useState, forwardRef } from 'react';
import apiClient from '../api/client';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  onLoad?: () => void;
}

export const AuthenticatedImage = forwardRef<HTMLImageElement, AuthenticatedImageProps>(
  ({ src, alt, className, fallback, onLoad }, ref) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;

    const fetchImage = async () => {
      try {
        setLoading(true);
        setError(false);

        // Fetch image with authentication
        const response = await apiClient.get(src, {
          responseType: 'blob',
        });

        // Create blob URL
        objectUrl = URL.createObjectURL(response.data);
        setBlobUrl(objectUrl);
      } catch (err) {
        console.error('Failed to load authenticated image:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    if (src) {
      fetchImage();
    }

    // Cleanup: revoke blob URL when component unmounts
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (loading) {
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

    return <img ref={ref} src={blobUrl} alt={alt} className={className} onLoad={onLoad} />;
  }
);

AuthenticatedImage.displayName = 'AuthenticatedImage';