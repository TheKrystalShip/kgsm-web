import React, { useState, useEffect } from 'react';
import imageService from '../../services/imageService';

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  fallbackSrc?: string;
  placeholderText?: string;
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
}

/**
 * A reusable image component that handles loading fallbacks
 * and prevents infinite loading attempts
 */
const ImageWithFallback: React.FC<ImageWithFallbackProps> = ({
  src,
  alt,
  fallbackSrc,
  placeholderText,
  className = '',
  style = {},
  width,
  height,
}) => {
  const [loadFailed, setLoadFailed] = useState(false);
  const [imgSrc, setImgSrc] = useState(src);
  
  // Reset status if source changes
  useEffect(() => {
    // Check if this specific image URL has failed before
    if (imageService.hasImageFailed(src)) {
      setLoadFailed(true);
      setImgSrc(fallbackSrc || imageService.getPlaceholderImage(placeholderText || alt));
    } else {
      setImgSrc(src);
      setLoadFailed(false);
    }
  }, [src, fallbackSrc, alt, placeholderText]);
  
  // Handle successful image load
  const handleLoad = () => {
    imageService.markImageLoaded(src, imgSrc);
  };
  
  // Handle image load error
  const handleError = () => {
    if (!loadFailed) {
      setLoadFailed(true);
      imageService.markImageFailed(src);
      setImgSrc(fallbackSrc || imageService.getPlaceholderImage(placeholderText || alt));
    }
  };
  
  return loadFailed && !fallbackSrc ? (
    <div 
      className={`placeholder-image ${className}`}
      style={{
        width: width || '100%',
        height: height || '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        ...style
      }}
    >
      <span>{placeholderText || alt}</span>
    </div>
  ) : (
    <img
      src={imgSrc}
      alt={alt}
      className={className}
      style={style}
      width={width}
      height={height}
      onLoad={handleLoad}
      onError={handleError}
      loading="lazy"
    />
  );
};

export default ImageWithFallback;
