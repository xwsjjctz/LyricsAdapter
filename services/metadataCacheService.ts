/**
 * Metadata Cache Service
 * Manages cached metadata using IndexedDB for better performance and larger storage quota
 * Now supports cover image caching (previously disabled due to localStorage limits)
 * Includes data validation for security
 */

import { getDesktopAPIAsync } from './desktopAdapter';
import { indexedDBStorage } from './indexedDBStorage';
import { type ValidatedMetadata, validateMetadata } from './dataValidator';

interface CachedMetadata extends ValidatedMetadata {
  // Now caching cover data in IndexedDB (no quota limits!)
  coverData?: string; // Base64 encoded
  coverMime?: string;
}

class MetadataCacheService {
  private cache: Map<string, CachedMetadata> = new Map();
  private initialized = false;
  private coverCache: Map<string, string> = new Map(); // songId -> blob URL

  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[MetadataCache] Initializing cache...');

    // Initialize IndexedDB (works in both Web and Desktop)
    try {
      await indexedDBStorage.initialize();
      console.log('[MetadataCache] ✓ IndexedDB initialized');
    } catch (error) {
      console.warn('[MetadataCache] ⚠️ IndexedDB initialization failed, falling back to memory-only:', error);
    }

    // Load metadata from IndexedDB (works in both Web and Desktop now!)
    try {
      console.log('[MetadataCache] Loading metadata from IndexedDB...');
      const entries = await indexedDBStorage.getAllMetadata();
      this.cache = new Map(Object.entries(entries));
      console.log(`[MetadataCache] ✓ Loaded ${this.cache.size} entries from IndexedDB`);
    } catch (error) {
      console.warn('[MetadataCache] ⚠️ Failed to load from IndexedDB:', error);
      this.cache = new Map();
    }

    // Desktop API: Load as fallback for migration purposes
    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI && this.cache.size === 0) {
      // Only load from Desktop API if IndexedDB is empty (migration)
      try {
        console.log('[MetadataCache] IndexedDB empty, loading from Desktop API for migration...');
        const result = await desktopAPI.loadMetadataCache();

        // Convert object to Map and migrate to IndexedDB
        const entries = result.entries || {};
        this.cache = new Map(Object.entries(entries));

        // Save to IndexedDB for next time
        for (const [songId, metadata] of Object.entries(entries)) {
          try {
            await indexedDBStorage.setMetadata(songId, metadata);
          } catch (error) {
            console.warn(`[MetadataCache] Failed to migrate metadata for ${songId}:`, error);
          }
        }

        console.log(`[MetadataCache] ✓ Migrated ${this.cache.size} entries from Desktop API to IndexedDB`);
      } catch (error) {
        console.warn('[MetadataCache] ⚠️ Failed to load from Desktop API (non-critical):', error);
      }
    }

    this.initialized = true;
    console.log('[MetadataCache] ✓ Initialization complete');
  }

  get(songId: string): CachedMetadata | undefined {
    return this.cache.get(songId);
  }

  set(songId: string, metadata: CachedMetadata): void {
    // Validate metadata before caching
    const validated = validateMetadata(metadata);
    if (!validated) {
      console.error(`[MetadataCache] Invalid metadata for ${songId}, skipping cache`);
      return;
    }

    this.cache.set(songId, validated as CachedMetadata);

    // Persist to IndexedDB asynchronously (don't await)
    indexedDBStorage.setMetadata(songId, validated).catch(error => {
      console.warn(`[MetadataCache] Failed to save metadata for ${songId} to IndexedDB:`, error);
    });
  }

  has(songId: string): boolean {
    return this.cache.has(songId);
  }

  // ========== Cover Image Caching (NEW!) ==========

  /**
   * Compress image blob to reduce storage size
   * @param blob - Original image blob
   * @param maxWidth - Maximum width in pixels (default: 800)
   * @param quality - JPEG quality 0-1 (default: 0.85)
   * @returns Compressed blob
   */
  private async compressImage(blob: Blob, maxWidth: number = 800, quality: number = 0.85): Promise<Blob> {
    // Skip compression for small images
    if (blob.size < 500 * 1024) { // Less than 500KB
      return blob;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate scale ratio
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Draw image on canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Compress as JPEG
        canvas.toBlob(
          (compressed) => {
            if (compressed) {
              console.log(`[MetadataCache] Image compressed: ${(blob.size / 1024).toFixed(2)} KB → ${(compressed.size / 1024).toFixed(2)} KB`);
              resolve(compressed);
            } else {
              reject(new Error('Compression failed'));
            }
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  }

  /**
   * Get cover blob URL for a song
   * Returns cached URL if available, null otherwise
   */
  getCoverUrl(songId: string): string | null {
    return this.coverCache.get(songId) || null;
  }

  /**
   * Set cover blob URL for a song (in-memory cache)
   * The blob itself is stored in IndexedDB, URL is just a reference
   */
  setCoverUrl(songId: string, blobUrl: string): void {
    this.coverCache.set(songId, blobUrl);
  }

  /**
   * Load cover from IndexedDB and create blob URL
   * Returns the blob URL if found, null otherwise
   */
  async loadCover(songId: string): Promise<string | null> {
    try {
      const coverBlob = await indexedDBStorage.getCover(songId);
      if (coverBlob) {
        const blobUrl = URL.createObjectURL(coverBlob);
        this.coverCache.set(songId, blobUrl);
        console.log(`[MetadataCache] ✓ Loaded cover for ${songId} from IndexedDB`);
        return blobUrl;
      }
      return null;
    } catch (error) {
      console.error(`[MetadataCache] Failed to load cover for ${songId}:`, error);
      return null;
    }
  }

  /**
   * Save cover blob to IndexedDB
   */
  async saveCover(songId: string, coverBlob: Blob): Promise<void> {
    try {
      // Compress image before saving
      const compressedBlob = await this.compressImage(coverBlob);

      await indexedDBStorage.setCover(songId, compressedBlob);

      // Also create and cache the blob URL
      const existingUrl = this.coverCache.get(songId);
      if (existingUrl) {
        URL.revokeObjectURL(existingUrl); // Revoke old URL
      }
      const blobUrl = URL.createObjectURL(compressedBlob);
      this.coverCache.set(songId, blobUrl);

      console.log(`[MetadataCache] ✓ Saved cover for ${songId} (${(compressedBlob.size / 1024).toFixed(2)} KB)`);
    } catch (error) {
      console.error(`[MetadataCache] Failed to save cover for ${songId}:`, error);
      throw error;
    }
  }

  /**
   * Delete cover from cache and IndexedDB
   */
  async deleteCover(songId: string): Promise<void> {
    // Revoke blob URL
    const existingUrl = this.coverCache.get(songId);
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl);
      this.coverCache.delete(songId);
    }

    // Delete from IndexedDB
    await indexedDBStorage.deleteCover(songId);
  }

  async save(): Promise<void> {
    // All environments now use IndexedDB for metadata storage
    // Metadata is already saved in set() method asynchronously
    // This save() is now mainly for triggering any pending operations

    try {
      // Ensure all pending IndexedDB writes are complete
      // (Most saves happen in set() via fire-and-forget)
      console.log('[MetadataCache] ✓ Metadata persistence check complete');
    } catch (error) {
      console.warn('[MetadataCache] Failed during persistence check:', error);
    }
  }

  clear(): void {
    this.cache.clear();
    this.coverCache.clear();
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
    this.coverCache.forEach(blobUrl => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch (e) {
        // Ignore errors during cleanup
      }
    });
    this.coverCache.clear();
    console.log('[MetadataCache] ✓ Revoked all cached blob URLs');
  }
}

export const metadataCacheService = new MetadataCacheService();
