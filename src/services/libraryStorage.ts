/**
 * 音乐库持久化存储服务
 * 处理与 Electron 主进程的通信，实现数据的读写和验证
 */

import { Track } from '../types';
import { getDesktopAPIAsync } from './desktopAdapter';
import { logger } from './logger';
import type {
  PersistedLibrarySettings as LibrarySettings,
  PersistedLibrarySnapshot as LibraryIndexData,
} from '../domain/library-persistence/models';

export type {
  PersistedLibrarySettings as LibrarySettings,
  PersistedLibrarySnapshot as LibraryIndexData,
  PersistedLibrarySong as LibraryIndexSong,
} from '../domain/library-persistence/models';

export interface LibraryData {
  songs: Track[];
  settings: LibrarySettings;
}

interface ValidationResult {
  id: string;
  exists: boolean;
}

class LibraryStorageService {
  private saveTimer: NodeJS.Timeout | null = null;
  private saveDelay = 1000; // 防抖延迟：1秒
  private pendingLibrary: LibraryIndexData | null = null;
  private saveInFlight: Promise<boolean> | null = null;

  clearSaveTimer(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.pendingLibrary = null;
  }

  private runSave(library: LibraryIndexData): Promise<boolean> {
    // Serialize physical writes. Starting a newer write while an older one is
    // still in flight can otherwise let the older snapshot land last and
    // overwrite the close snapshot.
    const previousSave = this.saveInFlight;
    const savePromise = (previousSave
      ? previousSave.then(
          () => this.saveLibrary(library),
          () => this.saveLibrary(library),
        )
      : this.saveLibrary(library)
    ).finally(() => {
      if (this.saveInFlight === savePromise) {
        this.saveInFlight = null;
      }
    });
    this.saveInFlight = savePromise;
    return savePromise;
  }

  /**
   * 从磁盘加载音乐库
   */
  async loadLibrary(): Promise<LibraryIndexData> {
    try {
      const api = await getDesktopAPIAsync();
      if (!api) {
        logger.warn('[LibraryStorage] Desktop API not available');
        return { songs: [], settings: {} };
      }

      logger.debug('[LibraryStorage] Loading library from disk...');
      const result = await api.loadLibraryIndex();

      if (result.success) {
        const library = result.library as LibraryIndexData;
        logger.debug('[LibraryStorage] Library loaded successfully, songs:', library.songs?.length || 0);
        return library;
      } else {
        logger.error('[LibraryStorage] Failed to load library:', result.error);
        return { songs: [], settings: {} };
      }
    } catch (error) {
      logger.error('[LibraryStorage] Error loading library:', error);
      return { songs: [], settings: {} };
    }
  }

  /**
   * 保存音乐库到磁盘
   */
  async saveLibrary(library: LibraryIndexData): Promise<boolean> {
    try {
      const api = await getDesktopAPIAsync();
      if (!api) {
        logger.warn('[LibraryStorage] Desktop API not available');
        return false;
      }

      logger.debug('[LibraryStorage] Saving library to disk, songs:', library.songs.length);
      const result = await api.saveLibraryIndex(library);

      if (result.success) {
        logger.debug('[LibraryStorage] Library saved successfully');
        return true;
      } else {
        logger.error('[LibraryStorage] Failed to save library:', result.error);
        return false;
      }
    } catch (error) {
      logger.error('[LibraryStorage] Error saving library:', error);
      return false;
    }
  }

  /**
   * 防抖保存：延迟执行保存操作，避免频繁写入
   */
  saveLibraryDebounced(library: LibraryIndexData): void {
    this.pendingLibrary = library;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const pendingLibrary = this.pendingLibrary;
      this.pendingLibrary = null;
      if (pendingLibrary) {
        this.runSave(pendingLibrary);
      }
    }, this.saveDelay);
  }

  async flushPendingSave(library?: LibraryIndexData): Promise<boolean> {
    if (library) {
      this.pendingLibrary = library;
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    const pendingLibrary = this.pendingLibrary;
    this.pendingLibrary = null;

    if (pendingLibrary) {
      return this.runSave(pendingLibrary);
    }

    if (this.saveInFlight) {
      return this.saveInFlight;
    }

    return true;
  }

  /**
   * Drain every runtime cache write before capturing the final close snapshot.
   *
   * The loop deliberately waits for the current in-flight write before taking
   * the pending debounced value. A new pending value may be queued while an
   * earlier write is settling, so the queue is re-checked after every await.
   */
  async drainBeforeClose(): Promise<boolean> {
    let allSaved = true;

    while (true) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }

      const inFlight = this.saveInFlight;
      if (inFlight) {
        allSaved = (await inFlight) && allSaved;
        continue;
      }

      const pendingLibrary = this.pendingLibrary;
      this.pendingLibrary = null;
      if (pendingLibrary) {
        allSaved = (await this.runSave(pendingLibrary)) && allSaved;
        continue;
      }

      return allSaved;
    }
  }

  /**
   * 验证单个文件路径是否存在
   */
  async validateFilePath(filePath: string): Promise<boolean> {
    try {
      const api = await getDesktopAPIAsync();
      if (!api) {
        return false;
      }

      return await api.validateFilePath(filePath);
    } catch (error) {
      logger.error('[LibraryStorage] Error validating file path:', error);
      return false;
    }
  }

  /**
   * 验证所有文件路径
   */
  async validateAllPaths(songs: Track[]): Promise<ValidationResult[]> {
    try {
      const api = await getDesktopAPIAsync();
      if (!api) {
        return songs.map(song => ({ id: song.id, exists: false }));
      }

      const result = await api.validateAllPaths(songs);

      if (result.success) {
        return result.results as ValidationResult[];
      } else {
        logger.error('[LibraryStorage] Failed to validate paths:', result.error);
        return songs.map(song => ({ id: song.id, exists: false }));
      }
    } catch (error) {
      logger.error('[LibraryStorage] Error validating paths:', error);
      return songs.map(song => ({ id: song.id, exists: false }));
    }
  }

  /**
   * 获取应用数据目录路径
   */
  async getAppDataPath(): Promise<string | null> {
    try {
      const api = await getDesktopAPIAsync();
      if (!api) {
        return null;
      }

      return await api.getAppDataPath();
    } catch (error) {
      logger.error('[LibraryStorage] Error getting app data path:', error);
      return null;
    }
  }
}

// 导出单例实例
export const libraryStorage = new LibraryStorageService();
