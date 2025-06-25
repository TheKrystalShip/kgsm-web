/**
 * Image Loading Service
 *
 * A dedicated service for handling image loading with proper fallbacks
 * and error handling to prevent infinite loading attempts.
 */

import { ImageLoadResult, STEAM_APP_IDS } from '../models/image';

interface CachedParentAppId {
  parentId: string;
  timestamp: number;
}

interface CachedImageUrl {
  url: string;
  timestamp: number;
  status: 'loaded' | 'error';
}

class ImageService {
  // In-memory cache for image load status (for current session)
  private imageStatusCache: Map<string, ImageLoadResult> = new Map();

  // Cache keys for localStorage
  private readonly PARENT_APP_CACHE_KEY = 'kgsm_parent_app_ids';
  private readonly IMAGE_URL_CACHE_KEY = 'kgsm_image_urls';

  // Cache expiration times (in milliseconds)
  private readonly PARENT_APP_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly IMAGE_URL_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Get cached parent app IDs from localStorage
   */
  private getCachedParentAppIds(): Map<string, CachedParentAppId> {
    try {
      const cached = localStorage.getItem(this.PARENT_APP_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        return new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load parent app ID cache:', error);
    }
    return new Map();
  }

  /**
   * Save parent app IDs to localStorage
   */
  private saveCachedParentAppIds(cache: Map<string, CachedParentAppId>): void {
    try {
      const data = Object.fromEntries(cache);
      localStorage.setItem(this.PARENT_APP_CACHE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save parent app ID cache:', error);
    }
  }

  /**
   * Get cached image URLs from localStorage
   */
  private getCachedImageUrls(): Map<string, CachedImageUrl> {
    try {
      const cached = localStorage.getItem(this.IMAGE_URL_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        return new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load image URL cache:', error);
    }
    return new Map();
  }

  /**
   * Save image URLs to localStorage
   */
  private saveCachedImageUrls(cache: Map<string, CachedImageUrl>): void {
    try {
      const data = Object.fromEntries(cache);
      localStorage.setItem(this.IMAGE_URL_CACHE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save image URL cache:', error);
    }
  }

  /**
   * Check if a cached entry is still valid
   */
  private isCacheValid(timestamp: number, duration: number): boolean {
    return Date.now() - timestamp < duration;
  }

  /**
   * Get a cache key for image lookups
   */
  private getImageCacheKey(gameName: string, appId?: string): string {
    return `${gameName}|${appId || 'no-app-id'}`;
  }

  /**
   * Check if an image URL exists by making a HEAD request
   * @param imageUrl The URL to check
   * @returns Promise that resolves to true if image exists
   */
  private async checkImageExists(imageUrl: string): Promise<boolean> {
    try {
      const response = await fetch(imageUrl, { method: 'HEAD' });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fetch the parent app ID for a dedicated server from Steam API
   * @param serverAppId The app ID of the dedicated server
   * @returns The parent app ID or the original app ID if no parent exists
   */
  private async getSteamParentAppId(serverAppId: string): Promise<string> {
    const cache = this.getCachedParentAppIds();

    // Check cache first
    const cached = cache.get(serverAppId);
    if (cached && this.isCacheValid(cached.timestamp, this.PARENT_APP_CACHE_DURATION)) {
            this.log(`🔍 [ImageService] Using cached parent ID for ${serverAppId}: ${cached.parentId}`);
      return cached.parentId;
    }

    this.log(`🌐 [ImageService] Fetching parent app ID from Steam API for server app ${serverAppId}`);

    try {
      const apiUrl = `https://store.steampowered.com/api/appdetails?appids=${serverAppId}`;
      this.log(`📡 [ImageService] Steam API Request: ${apiUrl}`);

      const response = await fetch(apiUrl);
      const data = await response.json();
      const info = data[serverAppId]?.data;

      const parentId = info?.parent_appid ?? serverAppId;

      this.log(`📋 [ImageService] Steam API Response for ${serverAppId}:`, {
        success: !!data[serverAppId]?.success,
        hasData: !!info,
        parentAppId: info?.parent_appid,
        resolvedParentId: parentId,
        gameType: info?.type,
        gameName: info?.name
      });

      // Cache the result
      cache.set(serverAppId, {
        parentId,
        timestamp: Date.now()
      });
      this.saveCachedParentAppIds(cache);

      return parentId;
    } catch (error) {
      console.warn(`⚠️ [ImageService] Failed to fetch parent app ID for ${serverAppId}:`, error);

      // If we have an expired cache entry, use it as fallback
      if (cached) {
        this.log(`🔄 [ImageService] Using expired cache entry for ${serverAppId}: ${cached.parentId}`);
        return cached.parentId;
      }

      // Otherwise cache the original ID as fallback
      cache.set(serverAppId, {
        parentId: serverAppId,
        timestamp: Date.now()
      });
      this.saveCachedParentAppIds(cache);

      this.log(`🔄 [ImageService] Fallback: Using original app ID ${serverAppId} as parent ID`);
      return serverAppId;
    }
  }

  /**
   * Get the appropriate image source for a game
   * @param gameName The name of the game
   * @param appId Optional app ID if available from the game itself
   * @returns Promise that resolves to the image source URL
   */
  async getGameImageSrc(gameName: string, appId?: string): Promise<string> {
        this.log(`🎮 [ImageService] Getting image for game: "${gameName}", App ID: ${appId || 'none'}`);

    const cacheKey = this.getImageCacheKey(gameName, appId);

    // Check in-memory cache first (for current session)
    const sessionCached = this.imageStatusCache.get(cacheKey);
    if (sessionCached && sessionCached.status !== 'loading') {
      this.log(`💾 [ImageService] Using session cache for "${gameName}": ${sessionCached.src}`);
      return sessionCached.src;
    }

    // Check persistent cache
    const persistentCache = this.getCachedImageUrls();
    const cached = persistentCache.get(cacheKey);
    if (cached && this.isCacheValid(cached.timestamp, this.IMAGE_URL_CACHE_DURATION)) {
      this.log(`💿 [ImageService] Using persistent cache for "${gameName}": ${cached.url}`);
      // Update in-memory cache
      this.imageStatusCache.set(cacheKey, { src: cached.url, status: cached.status });
      return cached.url;
    }

    const normalizedGameName = gameName.toLowerCase();
    const steamId = STEAM_APP_IDS[normalizedGameName];

    let imageUrl: string;
    let imageSource: string;

    // If we have a Steam AppID mapping, use it
    if (steamId) {
      imageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${steamId}/library_600x900_2x.jpg`;
      imageSource = `Static Steam ID mapping (${steamId})`;
      this.log(`🎯 [ImageService] Using static Steam ID mapping for "${gameName}": ${steamId} -> ${imageUrl}`);
    } else if (appId && appId !== "0") {
      // If the game has an AppId in its blueprint, try to use that
      try {
        this.log(`🔍 [ImageService] Processing app ID ${appId} for "${gameName}"`);

        // Fetch the parent app ID for potential dedicated servers
        const parentAppId = await this.getSteamParentAppId(appId);
        imageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${parentAppId}/library_600x900_2x.jpg`;
        imageSource = `Parent app ID resolution (${appId} -> ${parentAppId})`;

        this.log(`🔗 [ImageService] Constructed image URL for "${gameName}": ${imageUrl}`);
      } catch (error) {
        console.warn(`❌ [ImageService] Failed to process app ID ${appId} for "${gameName}":`, error);
        // Fallback to using the original app ID
        imageUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900_2x.jpg`;
        imageSource = `Direct app ID (fallback after error)`;
        this.log(`🔄 [ImageService] Fallback image URL for "${gameName}": ${imageUrl}`);
      }
    } else {
      // Fallback to placeholder
      imageUrl = this.getPlaceholderImage(gameName);
      imageSource = 'Placeholder (no app ID available)';
      this.log(`🖼️ [ImageService] Using placeholder for "${gameName}": ${imageUrl}`);
    }

        // Check if the image actually exists (for Steam URLs only)
    if (imageUrl.includes('steamcdn-a.akamaihd.net')) {
      this.log(`🔍 [ImageService] Checking image availability for "${gameName}": ${imageUrl}`);
      const imageExists = await this.checkImageExists(imageUrl);
      this.log(`${imageExists ? '✅' : '❌'} [ImageService] Image ${imageExists ? 'EXISTS' : 'NOT FOUND'} for "${gameName}" (${imageSource}): ${imageUrl}`);

      if (!imageExists) {
        this.log(`🔄 [ImageService] Falling back to placeholder for "${gameName}" due to missing image`);
        imageUrl = this.getPlaceholderImage(gameName);
        imageSource = 'Placeholder (Steam image not found)';
      }
    }

    this.log(`📸 [ImageService] Final image URL for "${gameName}": ${imageUrl} (Source: ${imageSource})`);

    // Cache the result (assuming it will be valid, will be updated if it fails to load)
    const cacheEntry: CachedImageUrl = {
      url: imageUrl,
      timestamp: Date.now(),
      status: 'loaded'
    };

    persistentCache.set(cacheKey, cacheEntry);
    this.saveCachedImageUrls(persistentCache);

    // Update in-memory cache
    this.imageStatusCache.set(cacheKey, { src: imageUrl, status: 'loaded' });

    return imageUrl;
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
   * @param gameNameOrUrl The name of the game or direct image URL
   * @param src The source URL that loaded successfully
   * @param appId Optional app ID (used when gameNameOrUrl is a game name)
   */
  markImageLoaded(gameNameOrUrl: string, src: string, appId?: string): void {
    // If it looks like a URL, cache it directly
    if (gameNameOrUrl.startsWith('http')) {
      this.imageStatusCache.set(gameNameOrUrl, { src, status: 'loaded' });
      return;
    }

    // Otherwise treat it as a game name and use the full cache key
    const cacheKey = this.getImageCacheKey(gameNameOrUrl, appId);

    // Update in-memory cache
    this.imageStatusCache.set(cacheKey, { src, status: 'loaded' });

    // Update persistent cache
    const persistentCache = this.getCachedImageUrls();
    persistentCache.set(cacheKey, {
      url: src,
      timestamp: Date.now(),
      status: 'loaded'
    });
    this.saveCachedImageUrls(persistentCache);
  }

  /**
   * Mark an image as failed to load
   * @param gameNameOrUrl The name of the game or direct image URL
   * @param appId Optional app ID (used when gameNameOrUrl is a game name)
   */
  markImageFailed(gameNameOrUrl: string, appId?: string): void {
    // If it looks like a URL, cache it directly
    if (gameNameOrUrl.startsWith('http')) {
      const placeholderSrc = this.getPlaceholderImage('Unknown');
      this.imageStatusCache.set(gameNameOrUrl, { src: placeholderSrc, status: 'error' });
      return;
    }

    // Otherwise treat it as a game name and use the full cache key
    const cacheKey = this.getImageCacheKey(gameNameOrUrl, appId);
    const placeholderSrc = this.getPlaceholderImage(gameNameOrUrl);

    // Update in-memory cache
    this.imageStatusCache.set(cacheKey, { src: placeholderSrc, status: 'error' });

    // Update persistent cache
    const persistentCache = this.getCachedImageUrls();
    persistentCache.set(cacheKey, {
      url: placeholderSrc,
      timestamp: Date.now(),
      status: 'error'
    });
    this.saveCachedImageUrls(persistentCache);
  }

  /**
   * Check if an image has previously failed to load
   * @param gameNameOrUrl The name of the game or direct image URL
   * @param appId Optional app ID (used when gameNameOrUrl is a game name)
   * @returns True if the image has failed to load
   */
  hasImageFailed(gameNameOrUrl: string, appId?: string): boolean {
    // If it looks like a URL, use it directly as the cache key
    if (gameNameOrUrl.startsWith('http')) {
      const sessionResult = this.imageStatusCache.get(gameNameOrUrl);
      return sessionResult?.status === 'error';
    }

    // Otherwise treat it as a game name and use the full cache key
    const cacheKey = this.getImageCacheKey(gameNameOrUrl, appId);

    // Check in-memory cache first
    const sessionResult = this.imageStatusCache.get(cacheKey);
    if (sessionResult?.status === 'error') {
      return true;
    }

    // Check persistent cache
    const persistentCache = this.getCachedImageUrls();
    const cached = persistentCache.get(cacheKey);
    if (cached && this.isCacheValid(cached.timestamp, this.IMAGE_URL_CACHE_DURATION)) {
      return cached.status === 'error';
    }

    return false;
  }

  /**
   * Clear expired cache entries
   */
  cleanupExpiredCache(): void {
    // Clean parent app ID cache
    const parentCache = this.getCachedParentAppIds();
    let parentCacheModified = false;
    Array.from(parentCache.entries()).forEach(([key, value]) => {
      if (!this.isCacheValid(value.timestamp, this.PARENT_APP_CACHE_DURATION)) {
        parentCache.delete(key);
        parentCacheModified = true;
      }
    });
    if (parentCacheModified) {
      this.saveCachedParentAppIds(parentCache);
    }

    // Clean image URL cache
    const imageCache = this.getCachedImageUrls();
    let imageCacheModified = false;
    Array.from(imageCache.entries()).forEach(([key, value]) => {
      if (!this.isCacheValid(value.timestamp, this.IMAGE_URL_CACHE_DURATION)) {
        imageCache.delete(key);
        imageCacheModified = true;
      }
    });
    if (imageCacheModified) {
      this.saveCachedImageUrls(imageCache);
    }
  }

  /**
   * Reset all caches (both in-memory and persistent)
   */
  resetCache(): void {
    // Clear in-memory cache
    this.imageStatusCache.clear();

    // Clear persistent caches
    try {
      localStorage.removeItem(this.PARENT_APP_CACHE_KEY);
      localStorage.removeItem(this.IMAGE_URL_CACHE_KEY);
    } catch (error) {
      console.warn('Failed to clear persistent cache:', error);
    }
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheStats(): { parentAppIds: number; imageUrls: number; inMemory: number } {
    const parentCache = this.getCachedParentAppIds();
    const imageCache = this.getCachedImageUrls();

    return {
      parentAppIds: parentCache.size,
      imageUrls: imageCache.size,
      inMemory: this.imageStatusCache.size
    };
  }

  /**
   * Enable or disable diagnostic logging
   */
  private diagnosticLogging = true;

  /**
   * Set diagnostic logging on/off
   */
  setDiagnosticLogging(enabled: boolean): void {
    this.diagnosticLogging = enabled;
    console.log(`${enabled ? '🔊' : '🔇'} [ImageService] Diagnostic logging ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Print a summary of recent image loading activity
   */
  printDiagnosticSummary(): void {
    const stats = this.getCacheStats();
    console.group('🎮 [ImageService] Diagnostic Summary');
    console.log('📊 Cache Statistics:', stats);
    console.log('💾 Parent App IDs cached:', stats.parentAppIds);
    console.log('🖼️ Image URLs cached:', stats.imageUrls);
    console.log('⚡ In-memory cache size:', stats.inMemory);

    // Show some sample cached parent IDs
    const parentCache = this.getCachedParentAppIds();
    if (parentCache.size > 0) {
      console.log('🔍 Sample cached parent app IDs:');
      const entries = Array.from(parentCache.entries()).slice(0, 5);
      entries.forEach(([appId, data]) => {
        console.log(`  ${appId} -> ${data.parentId} (cached ${new Date(data.timestamp).toLocaleTimeString()})`);
      });
    }
    console.groupEnd();
  }

  private log(message: string, ...args: any[]): void {
    if (this.diagnosticLogging) {
      console.log(message, ...args);
    }
  }
}

// Create and export a singleton instance
const imageService = new ImageService();

// Clean up expired cache entries on service initialization
imageService.cleanupExpiredCache();

// Add diagnostic functions to window object for easy console access
if (typeof window !== 'undefined') {
  (window as any).imageServiceDiagnostics = {
    enableLogging: () => imageService.setDiagnosticLogging(true),
    disableLogging: () => imageService.setDiagnosticLogging(false),
    showSummary: () => imageService.printDiagnosticSummary(),
    getCacheStats: () => imageService.getCacheStats(),
    clearCache: () => {
      imageService.resetCache();
      console.log('🧹 [ImageService] All caches cleared');
    },

    // Helper to test a specific game
    testGame: async (gameName: string, appId?: string) => {
      console.group(`🧪 [ImageService] Testing game: ${gameName}`);
      try {
        const result = await imageService.getGameImageSrc(gameName, appId);
        console.log(`Result: ${result}`);
        return result;
      } catch (error) {
        console.error('Error:', error);
      } finally {
        console.groupEnd();
      }
    }
  };

  console.log('🔧 [ImageService] Diagnostics available via window.imageServiceDiagnostics');
  console.log('Available methods:');
  console.log('  - enableLogging() / disableLogging()');
  console.log('  - showSummary()');
  console.log('  - getCacheStats()');
  console.log('  - clearCache()');
  console.log('  - testGame(gameName, appId?)');
}

export default imageService;
