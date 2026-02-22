/**
 * IndexedDB Storage Service
 * Provides async, large-capacity storage for metadata and cover images
 * Replaces localStorage for better performance and larger storage quota
 * Includes data validation to prevent injection attacks
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  validateMetadata,
  validateMetadataMap,
  validateSongId,
  validateBlob,
  type ValidatedMetadata
} from './dataValidator';
import { logger } from './logger';
import { STORAGE } from '../constants/config';
import { Track } from '../types';
import type { LibraryData, LibraryIndexData, LibrarySettings } from './libraryStorage';

interface LyricsAdapterDB extends DBSchema {
  metadata: {
    key: string;
    value: {
      key: string;
      title: string;
      artist: string;
      album: string;
      duration: number;
      lyrics: string;
      syncedLyrics?: { time: number; text: string }[];
      fileName: string;
      fileSize: number;
      lastModified: number;
    };
  };
  covers: {
    key: string;
    value: Blob;
  };
  library: {
    key: string;
    value: LibraryData | LibraryIndexData;
  };
  settings: {
    key: string;
    value: string;
  };
}

class IndexedDBStorageService {
  private db: IDBPDatabase<LyricsAdapterDB> | null = null;
  private initialized = false;

  /**
   * Initialize IndexedDB database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      logger.debug('[IndexedDB] Opening database...');
      this.db = await openDB<LyricsAdapterDB>(STORAGE.DB_NAME, STORAGE.DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) {
          // Create metadata store
          if (!db.objectStoreNames.contains('metadata')) {
            const metadataStore = db.createObjectStore('metadata', { keyPath: 'key' });
            logger.debug('[IndexedDB] Created metadata store');
          }

          // Create covers store for Blob storage
          if (!db.objectStoreNames.contains('covers')) {
            const coversStore = db.createObjectStore('covers');
            logger.debug('[IndexedDB] Created covers store');
          }

          // Create library store for browser mode persistence
          if (!db.objectStoreNames.contains('library')) {
            const libraryStore = db.createObjectStore('library', { keyPath: 'key' });
            logger.debug('[IndexedDB] Created library store');
          }

          // Create settings store for app settings
          if (!db.objectStoreNames.contains('settings')) {
            const settingsStore = db.createObjectStore('settings');
            logger.debug('[IndexedDB] Created settings store');
          }
        },
      });

      this.initialized = true;
      logger.debug('[IndexedDB] ✓ Database opened successfully');
    } catch (error) {
      logger.error('[IndexedDB] ✗ Failed to open database:', error);
      throw error;
    }
  }

  /**
   * Ensure database is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // ========== Metadata Operations ==========

  /**
   * Get metadata for a song
   * Returns validated metadata or null if invalid/not found
   */
  async getMetadata(songId: string): Promise<ValidatedMetadata | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    // Validate songId
    const validSongId = validateSongId(songId);
    if (!validSongId) {
      logger.warn(`[IndexedDB] Invalid songId: ${songId}`);
      return null;
    }

    try {
      const result = await this.db.get('metadata', validSongId);
      if (!result) {
        return null;
      }

      // Extract the metadata from the result (exclude the key field)
      const { key, ...metadata } = result;

      // Validate the metadata structure
      const validated = validateMetadata(metadata);
      if (!validated) {
        logger.warn(`[IndexedDB] Invalid metadata structure for ${validSongId}, removing from cache`);
        // Remove invalid entry
        await this.db.delete('metadata', validSongId);
        return null;
      }

      return validated;
    } catch (error) {
      logger.error(`[IndexedDB] Failed to get metadata for ${validSongId}:`, error);
      return null;
    }
  }

  /**
   * Set metadata for a song
   * Validates metadata before storing
   */
  async setMetadata(songId: string, metadata: any): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    // Validate songId
    const validSongId = validateSongId(songId);
    if (!validSongId) {
      logger.error(`[IndexedDB] Invalid songId: ${songId}`);
      throw new Error('Invalid songId');
    }

    // Validate metadata structure
    const validated = validateMetadata(metadata);
    if (!validated) {
      logger.error(`[IndexedDB] Invalid metadata structure for ${validSongId}`);
      throw new Error('Invalid metadata structure');
    }

    try {
      await this.db.put('metadata', { key: validSongId, ...validated });
      logger.debug(`[IndexedDB] ✓ Saved metadata for ${validSongId}`);
    } catch (error) {
      logger.error(`[IndexedDB] ✗ Failed to save metadata for ${validSongId}:`, error);
      throw error;
    }
  }

  /**
   * Delete metadata for a song
   * Validates songId before deletion
   */
  async deleteMetadata(songId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    // Validate songId
    const validSongId = validateSongId(songId);
    if (!validSongId) {
      logger.warn(`[IndexedDB] Invalid songId for deletion: ${songId}`);
      return;
    }

    try {
      await this.db.delete('metadata', validSongId);
      logger.debug(`[IndexedDB] ✓ Deleted metadata for ${validSongId}`);
    } catch (error) {
      logger.error(`[IndexedDB] ✗ Failed to delete metadata for ${validSongId}:`, error);
    }
  }

  /**
   * Get all metadata
   * Returns validated metadata map, filtering out invalid entries
   */
  async getAllMetadata(): Promise<Record<string, ValidatedMetadata>> {
    await this.ensureInitialized();
    if (!this.db) {
      logger.error('[IndexedDB] Database not initialized!');
      return {};
    }

    try {
      const results = await this.db.getAll('metadata');
      const rawEntries: Record<string, any> = {};

      for (const result of results) {
        // Extract key and metadata from result
        const { key, ...metadata } = result;
        rawEntries[key] = metadata;
      }

      // Validate all entries
      const validatedEntries = validateMetadataMap(rawEntries);

      // If some entries were invalid, log a warning
      const filteredCount = Object.keys(rawEntries).length - Object.keys(validatedEntries).length;
      if (filteredCount > 0) {
        logger.warn(`[IndexedDB] Filtered out ${filteredCount} invalid metadata entries`);
      }

      logger.debug(`[IndexedDB] ✓ Loaded ${Object.keys(validatedEntries).length} valid metadata entries`);
      if (Object.keys(validatedEntries).length > 0) {
        logger.debug('[IndexedDB] Sample entries:', Object.keys(validatedEntries).slice(0, 3));
      }
      return validatedEntries;
    } catch (error) {
      logger.error('[IndexedDB] Failed to get all metadata:', error);
      return {};
    }
  }

  /**
   * Clear all metadata
   */
  async clearMetadata(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.clear('metadata');
      logger.debug('[IndexedDB] ✓ Cleared all metadata');
    } catch (error) {
      logger.error('[IndexedDB] Failed to clear metadata:', error);
    }
  }

  // ========== Cover Image Operations ==========

  /**
   * Get cover image for a song
   * Validates songId and returned Blob
   */
  async getCover(songId: string): Promise<Blob | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    // Validate songId
    const validSongId = validateSongId(songId);
    if (!validSongId) {
      logger.warn(`[IndexedDB] Invalid songId: ${songId}`);
      return null;
    }

    try {
      const result = await this.db.get('covers', validSongId);
      if (!result) {
        return null;
      }

      // Validate the returned blob
      if (!validateBlob(result, STORAGE.MAX_COVER_SIZE_BYTES)) {
        logger.warn(`[IndexedDB] Invalid blob in cache for ${validSongId}, removing`);
        await this.db.delete('covers', validSongId);
        return null;
      }

      return result;
    } catch (error) {
      logger.error(`[IndexedDB] Failed to get cover for ${validSongId}:`, error);
      return null;
    }
  }

  /**
   * Set cover image for a song
   * Validates songId and Blob before storing
   */
  async setCover(songId: string, coverBlob: Blob): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    // Validate songId
    const validSongId = validateSongId(songId);
    if (!validSongId) {
      logger.error(`[IndexedDB] Invalid songId: ${songId}`);
      throw new Error('Invalid songId');
    }

    // Validate Blob (max size from config)
    const validated = validateBlob(coverBlob, STORAGE.MAX_COVER_SIZE_BYTES);
    if (!validated) {
      logger.error(`[IndexedDB] Invalid cover blob for ${validSongId}`);
      throw new Error('Invalid cover blob');
    }

    try {
      // Use put with the blob as value and songId as key
      await this.db.put('covers', validated, validSongId);
      logger.debug(`[IndexedDB] ✓ Saved cover for ${validSongId} (${(validated.size / 1024).toFixed(2)} KB)`);
    } catch (error) {
      logger.error(`[IndexedDB] ✗ Failed to save cover for ${validSongId}:`, error);
      throw error;
    }
  }

  /**
   * Delete cover for a song
   * Validates songId before deletion
   */
  async deleteCover(songId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    // Validate songId
    const validSongId = validateSongId(songId);
    if (!validSongId) {
      logger.warn(`[IndexedDB] Invalid songId for deletion: ${songId}`);
      return;
    }

    try {
      await this.db.delete('covers', validSongId);
      logger.debug(`[IndexedDB] ✓ Deleted cover for ${validSongId}`);
    } catch (error) {
      logger.error(`[IndexedDB] ✗ Failed to delete cover for ${validSongId}:`, error);
    }
  }

  /**
   * Clear all covers
   */
  async clearCovers(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.clear('covers');
      logger.debug('[IndexedDB] ✓ Cleared all covers');
    } catch (error) {
      logger.error('[IndexedDB] Failed to clear covers:', error);
    }
  }

  // ========== Library Operations ==========

  /**
   * Load library from IndexedDB (for browser mode)
   */
  async loadLibrary(): Promise<LibraryData | LibraryIndexData | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    try {
      const result = await this.db.get('library', 'main');
      if (result) {
        logger.debug('[IndexedDB] ✓ Loaded library from IndexedDB');
        return result as LibraryData | LibraryIndexData;
      }
      return null;
    } catch (error) {
      logger.error('[IndexedDB] Failed to load library:', error);
      return null;
    }
  }

  /**
   * Save library to IndexedDB (for browser mode)
   */
  async saveLibrary(library: LibraryData | LibraryIndexData): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      // Store with key for retrieval - use unknown to avoid type conflicts
      const libraryEntry = { ...library, key: 'main' } as unknown as LibraryData | LibraryIndexData;
      await this.db.put('library', libraryEntry);
      logger.debug('[IndexedDB] ✓ Saved library to IndexedDB');
    } catch (error) {
      logger.error('[IndexedDB] Failed to save library:', error);
    }
  }

  // ========== Utility Operations ==========

  /**
   * Get database storage estimate
   */
  async getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        return {
          usage: estimate.usage || 0,
          quota: estimate.quota || 0,
        };
      } catch (error) {
        logger.error('[IndexedDB] Failed to get storage estimate:', error);
      }
    }
    return null;
  }

  /**
   * Clear all data (metadata + covers)
   */
  async clearAll(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.clear('metadata');
      await this.db.clear('covers');
      logger.debug('[IndexedDB] ✓ Cleared all data');
    } catch (error) {
      logger.error('[IndexedDB] Failed to clear all data:', error);
    }
  }

  // ========== Settings Operations ==========

  /**
   * Get a setting value by key
   */
  async getSetting(key: string): Promise<string | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    try {
      const result = await this.db.get('settings', key);
      return result ?? null;
    } catch (error) {
      logger.error(`[IndexedDB] Failed to get setting ${key}:`, error);
      return null;
    }
  }

  /**
   * Set a setting value
   */
  async setSetting(key: string, value: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.put('settings', value, key);
      logger.debug(`[IndexedDB] ✓ Saved setting: ${key}`);
    } catch (error) {
      logger.error(`[IndexedDB] Failed to save setting ${key}:`, error);
    }
  }

  /**
   * Delete a setting
   */
  async deleteSetting(key: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.delete('settings', key);
      logger.debug(`[IndexedDB] ✓ Deleted setting: ${key}`);
    } catch (error) {
      logger.error(`[IndexedDB] Failed to delete setting ${key}:`, error);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.debug('[IndexedDB] Database closed');
    }
  }
}

// Export singleton instance
export const indexedDBStorage = new IndexedDBStorageService();
