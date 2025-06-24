import React from 'react';
import { KgsmBlueprint } from '../../models/kgsm';
import imageService from '../../services/imageService';
import ImageWithFallback from '../common/ImageWithFallback';
import './BlueprintCard.css';

interface BlueprintCardProps {
  blueprint: KgsmBlueprint;
  onSelect: (blueprint: KgsmBlueprint) => void;
}

/**
 * Component for displaying a single blueprint as a Steam library-style card
 */
const BlueprintCard: React.FC<BlueprintCardProps> = ({ blueprint, onSelect }) => {
  // Safety check - prevent rendering invalid blueprints
  if (!blueprint || !blueprint.Name) {
    return null;
  }
  // Handle install button click
  const handleInstallClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    onSelect(blueprint);
  };

  // Handle card click for potential future expansion (e.g., detailed view)
  const handleCardClick = () => {
    // For now, just trigger install
    onSelect(blueprint);
  };

  // Get the image source from the imageService
  const getImageSrc = () => {
    return imageService.getGameImageSrc(blueprint.Name, blueprint.AppId);
  };

  return (
    <div className="blueprint-card" onClick={handleCardClick}>
      <div className="blueprint-image-container">
        <ImageWithFallback
          src={getImageSrc()}
          alt={`${blueprint.Name} cover`}
          placeholderText={blueprint.Name}
          className="blueprint-image"
        />

        {/* Hover overlay with install button */}
        <div className="blueprint-overlay">
          <div className="blueprint-overlay-content">
            <h3 className="blueprint-title">{blueprint.Name}</h3>
            <button
              className="blueprint-install-btn"
              onClick={handleInstallClick}
              aria-label={`Install ${blueprint.Name}`}
            >
              <svg className="install-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                <path fill="currentColor" d="M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32V274.7l-73.4-73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0l128-128c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L288 274.7V32zM64 352c-35.3 0-64 28.7-64 64v32c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V416c0-35.3-28.7-64-64-64H346.5l-45.3 45.3c-25 25-65.5 25-90.5 0L165.5 352H64zm368 56a24 24 0 1 1 0 48 24 24 0 1 1 0-48z"/>
              </svg>
              Install
            </button>
          </div>
        </div>
      </div>

      {/* Card footer with game name */}
      <div className="blueprint-footer">
        <h4 className="blueprint-name">{blueprint.Name}</h4>
      </div>
    </div>
  );
};

export default BlueprintCard;
