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
  type ValidatedMetadata
} from './dataValidator';
import { logger } from './logger';
import { STORAGE } from '../constants/config';
import type { LibraryData, LibraryIndexData } from './libraryStorage';

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
      syncedLyrics?: { time: number; text: string }[] | undefined;
      fileName: string;
      fileSize: number;
      lastModified: number;
    };
  };
  webdavMetadata: {
    key: string;
    value: {
      key: string;
      title: string;
      artist: string;
      album: string;
      coverUrl: string;
      duration: number;
      lyrics?: string;
      syncedLyrics?: { time: number; text: string }[] | undefined;
      fileSize: number;
      lastModified: string;
    };
  };
  library: {
    key: string;
    value: LibraryData | LibraryIndexData;
  };
  settings: {
    key: string;
    value: string;
  };
  webdavFileListSnapshot: {
    key: string;
    value: {
      key: string;
      size: number;
      lastModified: string;
    };
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
        upgrade(db, oldVersion, _newVersion, _transaction) {
          if (!db.objectStoreNames.contains('metadata')) {
            db.createObjectStore('metadata', { keyPath: 'key' });
            logger.debug('[IndexedDB] Created metadata store');
          }

          if (!db.objectStoreNames.contains('library')) {
            db.createObjectStore('library', { keyPath: 'key' });
            logger.debug('[IndexedDB] Created library store');
          }

          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings');
            logger.debug('[IndexedDB] Created settings store');
          }

          if (oldVersion < 2) {
            try {
              (db as unknown as { deleteObjectStore: (name: string) => void }).deleteObjectStore('covers');
              logger.debug('[IndexedDB] Removed covers store (v2 migration)');
            } catch {
              // Store may not exist, ignore
            }
          }

          if (oldVersion < 3) {
            if (!db.objectStoreNames.contains('webdavMetadata')) {
              db.createObjectStore('webdavMetadata', { keyPath: 'key' });
              logger.debug('[IndexedDB] Created webdavMetadata store');
            }
          }

          if (oldVersion < 4) {
            if (!db.objectStoreNames.contains('webdavFileListSnapshot')) {
              db.createObjectStore('webdavFileListSnapshot', { keyPath: 'key' });
              logger.debug('[IndexedDB] Created webdavFileListSnapshot store');
            }
          }
        },
        blocked() {
          logger.warn('[IndexedDB] Database blocked by another tab');
        },
        blocking() {
          logger.warn('[IndexedDB] Database blocking another tab');
        },
        terminated: () => {
          logger.error('[IndexedDB] Database terminated unexpectedly');
          this.initialized = false;
        },
      });
      this.initialized = true;
      logger.debug('[IndexedDB] ✓ Database ready');
    } catch (error) {
      logger.error('[IndexedDB] Failed to open database:', error);
      this.initialized = false;
      this.db = null;
      throw error;
    }
  }

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

  // ========== WebDAV Metadata Operations ==========

  async getWebdavMetadata(filePath: string): Promise<any | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    try {
      const result = await this.db.get('webdavMetadata', filePath);
      if (!result) return null;
      const { key, ...metadata } = result;
      return metadata;
    } catch (error) {
      logger.error(`[IndexedDB] Failed to get webdav metadata for ${filePath}:`, error);
      return null;
    }
  }

  async setWebdavMetadata(filePath: string, metadata: any): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.put('webdavMetadata', { key: filePath, ...metadata });
    } catch (error) {
      logger.error(`[IndexedDB] Failed to save webdav metadata for ${filePath}:`, error);
    }
  }

  async getAllWebdavMetadata(): Promise<Record<string, any>> {
    await this.ensureInitialized();
    if (!this.db) return {};

    try {
      const results = await this.db.getAll('webdavMetadata');
      const entries: Record<string, any> = {};
      for (const result of results) {
        const { key, ...metadata } = result;
        entries[key] = metadata;
      }
      return entries;
    } catch (error) {
      logger.error('[IndexedDB] Failed to get all webdav metadata:', error);
      return {};
    }
  }

  async clearWebdavMetadata(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.clear('webdavMetadata');
      logger.debug('[IndexedDB] Cleared all webdav metadata');
    } catch (error) {
      logger.error('[IndexedDB] Failed to clear webdav metadata:', error);
    }
  }

  // ========== WebDAV File List Snapshot Operations ==========

  async getFileListSnapshot(): Promise<Record<string, { size: number; lastModified: string }> | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    try {
      const results = await this.db.getAll('webdavFileListSnapshot');
      if (results.length === 0) return null;
      const entries: Record<string, { size: number; lastModified: string }> = {};
      for (const result of results) {
        const { key, ...data } = result;
        entries[key] = data;
      }
      return entries;
    } catch (error) {
      logger.error('[IndexedDB] Failed to get file list snapshot:', error);
      return null;
    }
  }

  async setFileListSnapshot(snapshot: Record<string, { size: number; lastModified: string }>): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      const tx = this.db.transaction('webdavFileListSnapshot', 'readwrite');
      await tx.store.clear();
      for (const [key, data] of Object.entries(snapshot)) {
        await tx.store.put({ key, ...data });
      }
      await tx.done;
      logger.debug('[IndexedDB] ✓ Saved file list snapshot (' + Object.keys(snapshot).length + ' files)');
    } catch (error) {
      logger.error('[IndexedDB] Failed to save file list snapshot:', error);
    }
  }

  async clearFileListSnapshot(): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.clear('webdavFileListSnapshot');
      logger.debug('[IndexedDB] Cleared file list snapshot');
    } catch (error) {
      logger.error('[IndexedDB] Failed to clear file list snapshot:', error);
    }
  }

  // ========== Library Operations ==========

  /**
   * @deprecated Browser mode only - use libraryStorage.saveLibrary() for Electron
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
   * @deprecated Browser mode only - use libraryStorage.saveLibrary() for Electron
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
      logger.debug('[IndexedDB] ✓ Cleared all metadata');
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
