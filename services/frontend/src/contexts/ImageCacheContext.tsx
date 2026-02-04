/**
 * Image blob cache context for prefetching and caching full-size images
 */
import React, { createContext, useContext, useRef, useCallback } from 'react';
import apiClient from '../api/client';

interface ImageCacheContextType {
  getImageBlobUrl: (imageUrl: string) => string | null;
  prefetchImage: (imageUrl: string) => void;
  prefetchImages: (imageUrls: string[]) => void;
}

const ImageCacheContext = createContext<ImageCacheContextType | null>(null);

export const ImageCacheProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Cache maps image URL to blob URL
  const cacheRef = useRef<Map<string, string>>(new Map());
  // Track which URLs are being fetched to avoid duplicates
  const fetchingRef = useRef<Set<string>>(new Set());

  const prefetchImage = useCallback(async (imageUrl: string) => {
    // Skip if already cached or being fetched
    if (cacheRef.current.has(imageUrl) || fetchingRef.current.has(imageUrl)) {
      return;
    }

    fetchingRef.current.add(imageUrl);

    try {
      const response = await apiClient.get(imageUrl, {
        responseType: 'blob',
      });
      const blobUrl = URL.createObjectURL(response.data);
      cacheRef.current.set(imageUrl, blobUrl);
    } catch (err) {
      console.error('Failed to prefetch image:', imageUrl, err);
    } finally {
      fetchingRef.current.delete(imageUrl);
    }
  }, []);

  const prefetchImages = useCallback((imageUrls: string[]) => {
    // Prefetch images with a small delay between each to avoid overwhelming the server
    imageUrls.forEach((url, index) => {
      setTimeout(() => prefetchImage(url), index * 50);
    });
  }, [prefetchImage]);

  const getImageBlobUrl = useCallback((imageUrl: string): string | null => {
    return cacheRef.current.get(imageUrl) || null;
  }, []);

  return (
    <ImageCacheContext.Provider value={{ getImageBlobUrl, prefetchImage, prefetchImages }}>
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
