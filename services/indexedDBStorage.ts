/**
 * IndexedDB Storage Service
 * Provides async, large-capacity storage for metadata and cover images
 * Replaces localStorage for better performance and larger storage quota
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface LyricsAdapterDB extends DBSchema {
  metadata: {
    key: string;
    value: {
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
      console.log('[IndexedDB] Opening database...');
      this.db = await openDB<LyricsAdapterDB>('LyricsAdapter', 1, {
        upgrade(db) {
          // Create metadata store
          if (!db.objectStoreNames.contains('metadata')) {
            const metadataStore = db.createObjectStore('metadata', { keyPath: 'key' });
            console.log('[IndexedDB] Created metadata store');
          }

          // Create covers store for Blob storage
          if (!db.objectStoreNames.contains('covers')) {
            const coversStore = db.createObjectStore('covers');
            console.log('[IndexedDB] Created covers store');
          }
        },
      });

      this.initialized = true;
      console.log('[IndexedDB] ✓ Database opened successfully');
    } catch (error) {
      console.error('[IndexedDB] ✗ Failed to open database:', error);
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
   */
  async getMetadata(songId: string): Promise<any | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    try {
      const result = await this.db.get('metadata', songId);
      return result?.value || null;
    } catch (error) {
      console.error(`[IndexedDB] Failed to get metadata for ${songId}:`, error);
      return null;
    }
  }

  /**
   * Set metadata for a song
   */
  async setMetadata(songId: string, metadata: any): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.put('metadata', { key: songId, value: metadata });
      console.log(`[IndexedDB] ✓ Saved metadata for ${songId}`);
    } catch (error) {
      console.error(`[IndexedDB] ✗ Failed to save metadata for ${songId}:`, error);
      throw error;
    }
  }

  /**
   * Delete metadata for a song
   */
  async deleteMetadata(songId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.delete('metadata', songId);
      console.log(`[IndexedDB] ✓ Deleted metadata for ${songId}`);
    } catch (error) {
      console.error(`[IndexedDB] ✗ Failed to delete metadata for ${songId}:`, error);
    }
  }

  /**
   * Get all metadata
   */
  async getAllMetadata(): Promise<Record<string, any>> {
    await this.ensureInitialized();
    if (!this.db) {
      console.error('[IndexedDB] Database not initialized!');
      return {};
    }

    try {
      const results = await this.db.getAll('metadata');
      const entries: Record<string, any> = {};

      for (const result of results) {
        entries[result.key] = result.value;
      }

      console.log(`[IndexedDB] ✓ Loaded ${Object.keys(entries).length} metadata entries`);
      if (Object.keys(entries).length > 0) {
        console.log('[IndexedDB] Sample entries:', Object.keys(entries).slice(0, 3));
      }
      return entries;
    } catch (error) {
      console.error('[IndexedDB] Failed to get all metadata:', error);
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
      console.log('[IndexedDB] ✓ Cleared all metadata');
    } catch (error) {
      console.error('[IndexedDB] Failed to clear metadata:', error);
    }
  }

  // ========== Cover Image Operations ==========

  /**
   * Get cover image for a song
   */
  async getCover(songId: string): Promise<Blob | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    try {
      const result = await this.db.get('covers', songId);
      return result?.value || null;
    } catch (error) {
      console.error(`[IndexedDB] Failed to get cover for ${songId}:`, error);
      return null;
    }
  }

  /**
   * Set cover image for a song
   */
  async setCover(songId: string, coverBlob: Blob): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      // Use put with separate key and value parameters
      await this.db.put('covers', coverBlob, songId);
      console.log(`[IndexedDB] ✓ Saved cover for ${songId} (${(coverBlob.size / 1024).toFixed(2)} KB)`);
    } catch (error) {
      console.error(`[IndexedDB] ✗ Failed to save cover for ${songId}:`, error);
      throw error;
    }
  }

  /**
   * Delete cover for a song
   */
  async deleteCover(songId: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.db) return;

    try {
      await this.db.delete('covers', songId);
      console.log(`[IndexedDB] ✓ Deleted cover for ${songId}`);
    } catch (error) {
      console.error(`[IndexedDB] ✗ Failed to delete cover for ${songId}:`, error);
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
      console.log('[IndexedDB] ✓ Cleared all covers');
    } catch (error) {
      console.error('[IndexedDB] Failed to clear covers:', error);
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
        console.error('[IndexedDB] Failed to get storage estimate:', error);
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
      console.log('[IndexedDB] ✓ Cleared all data');
    } catch (error) {
      console.error('[IndexedDB] Failed to clear all data:', error);
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
      console.log('[IndexedDB] Database closed');
    }
  }
}

// Export singleton instance
export const indexedDBStorage = new IndexedDBStorageService();
