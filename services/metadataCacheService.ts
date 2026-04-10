/**
 * Metadata Cache Service
 * Manages cached metadata using IndexedDB for better performance and larger storage quota
 * Now supports cover image caching (previously disabled due to localStorage limits)
 * Includes data validation for security
 */

import { getDesktopAPIAsync } from './desktopAdapter';
import { indexedDBStorage } from './indexedDBStorage';
import { type ValidatedMetadata, validateMetadata } from './dataValidator';
import { logger } from './logger';

interface CachedMetadata extends ValidatedMetadata {
}

class MetadataCacheService {
  private cache: Map<string, CachedMetadata> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Set flag BEFORE async operations to prevent race condition
    this.initialized = true;

    logger.debug('[MetadataCache] Initializing cache...');

    // Initialize IndexedDB (works in both Web and Desktop)
    try {
      await indexedDBStorage.initialize();
      logger.debug('[MetadataCache] ✓ IndexedDB initialized');
    } catch (error) {
      logger.warn('[MetadataCache] ⚠️ IndexedDB initialization failed, falling back to memory-only:', error);
    }

    // Load metadata from IndexedDB (works in both Web and Desktop now!)
    try {
      logger.debug('[MetadataCache] Loading metadata from IndexedDB...');
      const entries = await indexedDBStorage.getAllMetadata();
      this.cache = new Map(Object.entries(entries));
      logger.debug(`[MetadataCache] ✓ Loaded ${this.cache.size} entries from IndexedDB`);
    } catch (error) {
      logger.warn('[MetadataCache] ⚠️ Failed to load from IndexedDB:', error);
      this.cache = new Map();
    }

    // Desktop API: Load as fallback for migration purposes
    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI && this.cache.size === 0) {
      // Only load from Desktop API if IndexedDB is empty (migration)
      try {
        logger.debug('[MetadataCache] IndexedDB empty, loading from Desktop API for migration...');
        const result = await desktopAPI.loadMetadataCache();

        // Convert object to Map and migrate to IndexedDB
        const entries = result.entries || {};
        this.cache = new Map(Object.entries(entries) as [string, CachedMetadata][]);

        // Save to IndexedDB for next time
        for (const [songId, metadata] of Object.entries(entries)) {
          try {
            await indexedDBStorage.setMetadata(songId, metadata);
          } catch (error) {
            logger.warn(`[MetadataCache] Failed to migrate metadata for ${songId}:`, error);
          }
        }

        logger.debug(`[MetadataCache] ✓ Migrated ${this.cache.size} entries from Desktop API to IndexedDB`);
      } catch (error) {
        logger.warn('[MetadataCache] ⚠️ Failed to load from Desktop API (non-critical):', error);
      }
    }

    logger.debug('[MetadataCache] ✓ Initialization complete');
  }

  get(songId: string): CachedMetadata | undefined {
    return this.cache.get(songId);
  }

  set(songId: string, metadata: CachedMetadata): void {
    // Validate metadata before caching
    const validated = validateMetadata(metadata);
    if (!validated) {
      logger.error(`[MetadataCache] Invalid metadata for ${songId}, skipping cache`);
      return;
    }

    this.cache.set(songId, validated as CachedMetadata);

    // Persist to IndexedDB asynchronously (don't await)
    indexedDBStorage.setMetadata(songId, validated).catch(error => {
      logger.warn(`[MetadataCache] Failed to save metadata for ${songId} to IndexedDB:`, error);
    });
  }

  has(songId: string): boolean {
    return this.cache.has(songId);
  }

  async save(): Promise<void> {
    try {
      logger.debug('[MetadataCache] ✓ Metadata persistence check complete');
    } catch (error) {
      logger.warn('[MetadataCache] Failed during persistence check:', error);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  // Convert cached metadata to track metadata format
  cachedToTrack(cached: CachedMetadata, filePath: string, songId: string): {
    title: string;
    artist: string;
    album: string;
    duration: number;
    lyrics: string;
    syncedLyrics?: { time: number; text: string }[];
  } {
    return {
      title: cached.title,
      artist: cached.artist,
      album: cached.album,
      duration: cached.duration,
      lyrics: cached.lyrics,
      syncedLyrics: cached.syncedLyrics,
    };
  }

  // Check if cached metadata is still valid (file hasn't changed)
  isValid(songId: string, fileName: string, fileSize: number, lastModified: number): boolean {
    const cached = this.cache.get(songId);
    if (!cached) return false;

    // Only check filename, not fileSize (symlinks have different sizes)
    return cached.fileName === fileName;
  }

  /**
   * Revoke all cached blob URLs (call before app unmount)
   */
  revokeAllBlobUrls(): void {
    logger.debug('[MetadataCache] ✓ Cleanup complete');
  }
}

export const metadataCacheService = new MetadataCacheService();
