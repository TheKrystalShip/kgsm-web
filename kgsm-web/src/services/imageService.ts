/**
 * Image Loading Service
 *
 * A dedicated service for handling image loading with proper fallbacks
 * and error handling to prevent infinite loading attempts.
 */

import { ImageLoadResult, STEAM_APP_IDS } from '../models/image';

class ImageService {
  // Cache for image load status to prevent multiple loading attempts for the same image
  private imageStatusCache: Map<string, ImageLoadResult> = new Map();

  /**
   * Get the appropriate image source for a game
   * @param gameName The name of the game
   * @param appId Optional app ID if available from the game itself
   * @returns The image source URL
   */
  getGameImageSrc(gameName: string, appId?: string): string {
    const cachedResult = this.imageStatusCache.get(gameName);
    if (cachedResult && cachedResult.status !== 'loading') {
      return cachedResult.src;
    }

    const normalizedGameName = gameName.toLowerCase();
    const steamId = STEAM_APP_IDS[normalizedGameName];

    // If we have a Steam AppID mapping, use it
    if (steamId) {
      return `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_600x900.jpg`;
    }

    // If the game has an AppId in its blueprint, try to use that
    if (appId && appId !== "0") {
      return `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900.jpg`;
    }

    // Fallback to placeholder
    return this.getPlaceholderImage(gameName);
  }

  /**
   * Get a placeholder image for a game
   * @param gameName The name of the game
   * @returns A placeholder image URL
   */
  getPlaceholderImage(gameName: string): string {
    return `https://via.placeholder.com/200x300/294055/e6e2e6?text=${encodeURIComponent(gameName)}`;
  }

  /**
   * Mark an image as loaded successfully
   * @param gameName The name of the game
   * @param src The source URL that loaded successfully
   */
  markImageLoaded(gameName: string, src: string): void {
    this.imageStatusCache.set(gameName, { src, status: 'loaded' });
  }

  /**
   * Mark an image as failed to load
   * @param gameName The name of the game
   */
  markImageFailed(gameName: string): void {
    const placeholderSrc = this.getPlaceholderImage(gameName);
    this.imageStatusCache.set(gameName, { src: placeholderSrc, status: 'error' });
  }

  /**
   * Check if an image has previously failed to load
   * @param gameName The name of the game
   * @returns True if the image has failed to load
   */
  hasImageFailed(gameName: string): boolean {
    const result = this.imageStatusCache.get(gameName);
    return result?.status === 'error';
  }

  /**
   * Reset the image cache for testing or when needed
   */
  resetCache(): void {
    this.imageStatusCache.clear();
  }
}

// Create and export a singleton instance
const imageService = new ImageService();
export default imageService;
