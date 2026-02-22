/**
 * Track Processing Utilities
 * Helper functions for processing audio tracks during import
 */

import { DesktopAPI } from '../services/desktopAdapter';
import { metadataCacheService } from '../services/metadataCacheService';
import { logger } from '../services/logger';
import type { Track } from '../types';

export interface CoverProcessingResult {
  coverUrl: string;
  coverSavedToDisk: boolean;
}

/**
 * Process cover art from metadata
 * @param trackId - Track ID
 * @param coverData - Base64 encoded cover data
 * @param coverMime - Cover MIME type
 * @param desktopAPI - Desktop API (optional)
 * @param createTrackedBlobUrl - Function to create tracked blob URL
 * @returns Cover processing result
 */
export async function processCoverArt(
  trackId: string,
  coverData: string,
  coverMime: string,
  desktopAPI: DesktopAPI | null,
  createTrackedBlobUrl: (blob: Blob) => string
): Promise<CoverProcessingResult> {
  let coverUrl = `https://picsum.photos/seed/${trackId}/1000/1000`;
  let coverSavedToDisk = false;

  // Try to save to disk in Electron mode
  if (desktopAPI?.saveCoverThumbnail) {
    try {
      const coverResult = await desktopAPI.saveCoverThumbnail({
        id: trackId,
        data: coverData,
        mime: coverMime,
      });

      if (coverResult?.success && coverResult.coverUrl) {
        coverUrl = coverResult.coverUrl;
        coverSavedToDisk = true;
        logger.debug(`[CoverProcessor] ✓ Saved cover to disk: ${trackId}`);
      }
    } catch (error) {
      logger.warn('[CoverProcessor] Failed to save cover to disk:', error);
    }
  }

  // Fallback to IndexedDB if disk save failed or not available
  if (!coverSavedToDisk) {
    try {
      const byteCharacters = atob(coverData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: coverMime });
      coverUrl = createTrackedBlobUrl(blob);

      try {
        await metadataCacheService.saveCover(trackId, blob);
        logger.debug(`[CoverProcessor] ✓ Saved cover to IndexedDB: ${trackId}`);
      } catch (error) {
        logger.warn('[CoverProcessor] Failed to save cover to IndexedDB:', error);
      }
    } catch (error) {
      logger.error('[CoverProcessor] Failed to create cover blob:', error);
    }
  }

  return { coverUrl, coverSavedToDisk };
}

/**
 * Save metadata to cache
 * @param trackId - Track ID
 * @param metadata - Parsed metadata
 * @param coverSavedToDisk - Whether cover was saved to disk
 */
export async function saveMetadataToCache(
  trackId: string,
  metadata: {
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    lyrics?: string;
    syncedLyrics?: { time: number; text: string }[];
    coverData?: string;
    coverMime?: string;
    fileName?: string;
    fileSize?: number;
  },
  coverSavedToDisk: boolean
): Promise<void> {
  try {
    await metadataCacheService.set(trackId, {
      title: metadata.title || '',
      artist: metadata.artist || '',
      album: metadata.album || '',
      duration: metadata.duration || 0,
      lyrics: metadata.lyrics || '',
      syncedLyrics: metadata.syncedLyrics,
      coverData: coverSavedToDisk ? undefined : metadata.coverData,
      coverMime: coverSavedToDisk ? undefined : metadata.coverMime,
      fileName: metadata.fileName || '',
      fileSize: metadata.fileSize || 0,
      lastModified: Date.now(),
    });
    logger.debug(`[TrackProcessor] ✓ Cached metadata for: ${trackId}`);
  } catch (error) {
    logger.error('[TrackProcessor] Failed to cache metadata:', error);
  }
}

/**
 * Create a track object from metadata and file info
 * @param trackId - Track ID
 * @param fileName - File name
 * @param filePath - File path (optional, for Electron)
 * @param fileSize - File size in bytes
 * @param metadata - Parsed metadata
 * @param coverUrl - Cover URL
 * @returns Track object
 */
export function createTrackFromMetadata(
  trackId: string,
  fileName: string,
  filePath: string,
  fileSize: number,
  metadata: {
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    lyrics?: string;
    syncedLyrics?: { time: number; text: string }[];
  },
  coverUrl: string
): Track {
  return {
    id: trackId,
    title: metadata.title || fileName.replace(/\.[^/.]+$/, ''),
    artist: metadata.artist || 'Unknown Artist',
    album: metadata.album || 'Unknown Album',
    duration: metadata.duration || 0,
    lyrics: metadata.lyrics || '',
    syncedLyrics: metadata.syncedLyrics,
    coverUrl: coverUrl,
    audioUrl: '',
    fileName: fileName,
    filePath: filePath,
    fileSize: fileSize,
    lastModified: Date.now(),
    addedAt: new Date().toISOString(),
  };
}
