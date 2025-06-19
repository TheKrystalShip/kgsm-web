/**
 * Custom hook for image loading with fallbacks
 */

import { useState, useEffect } from 'react';
import imageService from '../services/imageService';

interface UseImageOptions {
  fallbackText?: string;
}

/**
 * Custom hook for loading images with proper fallback handling
 * @param src The source URL for the image
 * @param options Optional configuration options
 * @returns Object containing image status and source
 */
export function useImage(src: string, options: UseImageOptions = {}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(() => {
    return imageService.hasImageFailed(src) ? 'error' : 'loading';
  });
  
  const [imgSrc, setImgSrc] = useState<string>(() => {
    return imageService.hasImageFailed(src) 
      ? imageService.getPlaceholderImage(options.fallbackText || 'Image')
      : src;
  });

  // Method to manually mark image as loaded
  const markLoaded = () => {
    setStatus('loaded');
    imageService.markImageLoaded(src, imgSrc);
  };

  // Method to manually mark image as failed
  const markFailed = () => {
    setStatus('error');
    imageService.markImageFailed(src);
    setImgSrc(imageService.getPlaceholderImage(options.fallbackText || 'Image'));
  };

  // Update state when src changes
  useEffect(() => {
    // Check if image had previously failed
    if (imageService.hasImageFailed(src)) {
      setStatus('error');
      setImgSrc(imageService.getPlaceholderImage(options.fallbackText || 'Image'));
    } else {
      setStatus('loading');
      setImgSrc(src);
    }
  }, [src, options.fallbackText]);

  return {
    src: imgSrc,
    status,
    isLoading: status === 'loading',
    isLoaded: status === 'loaded',
    isError: status === 'error',
    markLoaded,
    markFailed
  };
}

export default useImage;
