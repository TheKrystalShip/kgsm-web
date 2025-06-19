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
 * Component for displaying a single blueprint as a card
 */
const BlueprintCard: React.FC<BlueprintCardProps> = ({ blueprint, onSelect }) => {
  // Handle card click
  const handleClick = () => {
    onSelect(blueprint);
  };

  // Get the image source from the imageService
  const getImageSrc = () => {
    return imageService.getGameImageSrc(blueprint.Name, blueprint.AppId);
  };

  return (
    <div className="blueprint-card">
      <div className="blueprint-image">
        <ImageWithFallback
          src={getImageSrc()}
          alt={`${blueprint.Name} cover`}
          placeholderText={blueprint.Name}
        />
      </div>
      <div className="blueprint-info">
        <h3 className="blueprint-name">{blueprint.Name}</h3>
        <button className="blueprint-install-btn" onClick={handleClick}>Install</button>
      </div>
    </div>
  );
};

export default BlueprintCard;
