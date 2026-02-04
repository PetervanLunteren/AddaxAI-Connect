/**
 * Image blob cache context for prefetching and caching full-size images
 */
import React, { createContext, useContext, useRef, useCallback } from 'react';
import apiClient from '../api/client';

interface ImageCacheContextType {
  getImageBlobUrl: (imageUrl: string) => string | null;
  getOrFetchImage: (imageUrl: string) => Promise<string>;
  prefetchImage: (imageUrl: string) => void;
  prefetchImages: (imageUrls: string[]) => void;
}

const ImageCacheContext = createContext<ImageCacheContextType | null>(null);

export const ImageCacheProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Cache maps image URL to blob URL
  const cacheRef = useRef<Map<string, string>>(new Map());
  // Track in-flight fetch promises so we can await them instead of starting duplicates
  const fetchPromisesRef = useRef<Map<string, Promise<string>>>(new Map());

  const fetchImage = useCallback(async (imageUrl: string): Promise<string> => {
    // Check cache first
    const cached = cacheRef.current.get(imageUrl);
    if (cached) {
      return cached;
    }

    // Check if already fetching - return existing promise
    const existingPromise = fetchPromisesRef.current.get(imageUrl);
    if (existingPromise) {
      return existingPromise;
    }

    // Start new fetch and store the promise
    const fetchPromise = (async () => {
      try {
        const response = await apiClient.get(imageUrl, {
          responseType: 'blob',
        });
        const blobUrl = URL.createObjectURL(response.data);
        cacheRef.current.set(imageUrl, blobUrl);
        return blobUrl;
      } finally {
        fetchPromisesRef.current.delete(imageUrl);
      }
    })();

    fetchPromisesRef.current.set(imageUrl, fetchPromise);
    return fetchPromise;
  }, []);

  const prefetchImage = useCallback((imageUrl: string) => {
    // Skip if already cached
    if (cacheRef.current.has(imageUrl)) {
      return;
    }
    // Start fetch (will be deduplicated by fetchImage)
    fetchImage(imageUrl).catch(err => {
      console.error('Failed to prefetch image:', imageUrl, err);
    });
  }, [fetchImage]);

  const prefetchImages = useCallback((imageUrls: string[]) => {
    // Prefetch images with a small delay between each to avoid overwhelming the server
    imageUrls.forEach((url, index) => {
      setTimeout(() => prefetchImage(url), index * 50);
    });
  }, [prefetchImage]);

  const getImageBlobUrl = useCallback((imageUrl: string): string | null => {
    return cacheRef.current.get(imageUrl) || null;
  }, []);

  const getOrFetchImage = useCallback((imageUrl: string): Promise<string> => {
    return fetchImage(imageUrl);
  }, [fetchImage]);

  return (
    <ImageCacheContext.Provider value={{ getImageBlobUrl, getOrFetchImage, prefetchImage, prefetchImages }}>
      {children}
    </ImageCacheContext.Provider>
  );
};

export const useImageCache = () => {
  const context = useContext(ImageCacheContext);
  if (!context) {
    throw new Error('useImageCache must be used within an ImageCacheProvider');
  }
  return context;
};
