// Example usage of useImage hook
import React from 'react';
import useImage from '../../hooks/useImage';

interface GameImageProps {
  gameName: string;
  appId?: string;
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
}

/**
 * Component for displaying a game image with proper fallback handling
 */
const GameImage: React.FC<GameImageProps> = ({ 
  gameName,
  appId,
  className = '',
  style = {},
  width,
  height
}) => {
  // Get Steam image URL based on game name or app ID
  const getSteamImageUrl = () => {
    // Logic to determine the URL based on gameName and appId
    if (appId && appId !== '0') {
      return `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900.jpg`;
    }
    
    return `https://via.placeholder.com/200x300/294055/e6e2e6?text=${encodeURIComponent(gameName)}`;
  };

  // Use the image hook to handle loading, errors, etc.
  const { src, isError, markLoaded, markFailed } = useImage(getSteamImageUrl(), {
    fallbackText: gameName
  });

  return (
    <div className={`game-image ${className}`} style={style}>
      {isError ? (
        <div className="placeholder-image">
          <span>{gameName}</span>
        </div>
      ) : (
        <img
          src={src}
          alt={`${gameName} cover`}
          width={width}
          height={height}
          onLoad={markLoaded}
          onError={markFailed}
          loading="lazy"
        />
      )}
    </div>
  );
};

export default GameImage;
