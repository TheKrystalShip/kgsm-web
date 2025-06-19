/**
 * Image Models
 *
 * Type definitions for image handling
 */

/**
 * Interface for the result of an image loading attempt
 */
export interface ImageLoadResult {
  src: string;
  status: 'loading' | 'loaded' | 'error';
}

/**
 * Steam AppID mapping for games
 * These IDs are used to fetch cover images from Steam's CDN
 */
export const STEAM_APP_IDS: Record<string, string> = {
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
