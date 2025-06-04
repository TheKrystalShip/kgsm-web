import React from 'react';
import { KgsmBlueprint } from '../../services/kgsmService';
import './BlueprintCard.css';

/**
 * Mapping of game names to their Steam AppIDs
 * These IDs are used to fetch cover images from Steam's CDN
 */
const steamAppIds: Record<string, string> = {
  '7dtd': '251570',           // 7 Days to Die
  'ark': '346110',            // ARK: Survival Evolved
  'barotrauma': '602960',     // Barotrauma
  'corekeeper': '1621690',    // Core Keeper
  'cssource': '240',          // Counter-Strike: Source
  'dontstarvetogether': '322330', // Don't Starve Together
  'factorio': '427520',       // Factorio
  'gmod': '4000',             // Garry's Mod
  'minecraft': '1672970',     // Minecraft (using preview AppID)
  'valheim': '892970',        // Valheim
  'terraria': '105600',       // Terraria
  'rust': '252490',           // Rust
  'csgo': '730',              // Counter-Strike: Global Offensive
  'tf2': '440',               // Team Fortress 2
  'stardewvalley': '413150',  // Stardew Valley
};

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

  // Get game image from Steam CDN or use fallback
  const getGameImage = () => {
    const gameName = blueprint.Name.toLowerCase();
    const appId = steamAppIds[gameName];
    
    // If we have a Steam AppID, use Steam's CDN
    if (appId) {
      return `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900.jpg`;
    }
    
    // If the game has an AppId in its blueprint, try to use that
    if (blueprint.AppId && blueprint.AppId !== "0") {
      return `https://steamcdn-a.akamaihd.net/steam/apps/${blueprint.AppId}/library_600x900.jpg`;
    }
    
    // Fallback to placeholder
    return `https://via.placeholder.com/200x300/294055/e6e2e6?text=${blueprint.Name}`;
  };

  // Handle image load error
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // Set fallback image when Steam CDN image fails to load
    e.currentTarget.src = `https://via.placeholder.com/200x300/294055/e6e2e6?text=${blueprint.Name}`;
  };

  return (
    <div className="blueprint-card">
      <div className="blueprint-image">
        <img 
          src={getGameImage()} 
          alt={`${blueprint.Name} cover`} 
          onError={handleImageError}
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
