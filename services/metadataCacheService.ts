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
  coverData?: string; // Base64 encoded
  coverMime?: string;
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
      console.error('[MetadataCache] Failed to save cache:', error);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  // Convert cached metadata to track metadata format
  cachedToTrack(cached: CachedMetadata, filePath: string, songId: string): Partial<{
    title: string;
    artist: string;
    album: string;
    duration: number;
    lyrics: string;
    syncedLyrics: { time: number; text: string }[];
    coverUrl: string;
  }> {
    const result: any = {
      title: cached.title,
      artist: cached.artist,
      album: cached.album,
      duration: cached.duration,
      lyrics: cached.lyrics,
      syncedLyrics: cached.syncedLyrics,
    };

    // Convert Base64 cover data to blob URL
    if (cached.coverData && cached.coverMime) {
      try {
        const byteCharacters = atob(cached.coverData);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: cached.coverMime });
        result.coverUrl = URL.createObjectURL(blob);
      } catch (e) {
        console.error('[MetadataCache] Failed to decode cover data:', e);
      }
    }

    return result;
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
