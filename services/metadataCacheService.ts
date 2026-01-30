/**
 * Metadata Cache Service
 * Manages cached metadata to avoid re-parsing audio files
 */

import { getDesktopAPIAsync } from './desktopAdapter';

interface CachedMetadata {
  title: string;
  artist: string;
  album: string;
  duration: number;
  lyrics: string;
  syncedLyrics?: { time: number; text: string }[];
  // NOTE: NOT caching coverData/coverMime to avoid localStorage quota exceeded errors
  // Cover images can be re-extracted from audio files when needed
  fileName: string;
  fileSize: number;
  lastModified: number;
}

class MetadataCacheService {
  private cache: Map<string, CachedMetadata> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) {
      console.log('[MetadataCache] Not in desktop mode, skipping cache load');
      this.initialized = true;
      return;
    }

    try {
      console.log('[MetadataCache] Loading metadata cache...');
      const result = await desktopAPI.loadMetadataCache();

      // Convert object to Map
      this.cache = new Map(
        Object.entries(result.entries || {})
      );

      console.log(`[MetadataCache] ✓ Loaded ${this.cache.size} cached entries`);
      this.initialized = true;
    } catch (error) {
      console.error('[MetadataCache] Failed to load cache:', error);
      this.cache = new Map();
      this.initialized = true;
    }
  }

  get(songId: string): CachedMetadata | undefined {
    return this.cache.get(songId);
  }

  set(songId: string, metadata: CachedMetadata): void {
    this.cache.set(songId, metadata);
  }

  has(songId: string): boolean {
    return this.cache.has(songId);
  }

  async save(): Promise<void> {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) return;

    try {
      // Convert Map to object
      const entriesObj = Object.fromEntries(this.cache);

      await desktopAPI.saveMetadataCache({ entries: entriesObj });
      console.log(`[MetadataCache] ✓ Saved ${this.cache.size} entries to disk`);
    } catch (error) {
      // Log warning but don't throw - allow app to continue without cache
      console.warn('[MetadataCache] Failed to save cache (non-critical):', error);
      console.warn('[MetadataCache] App will continue without cache persistence');
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
}

export const metadataCacheService = new MetadataCacheService();
