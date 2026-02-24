/**
 * 音乐库持久化存储服务
 * 处理与 Electron 主进程的通信，实现数据的读写和验证
 */

import { Track } from '../types';
import { getDesktopAPIAsync } from './desktopAdapter';
import { logger } from './logger';

export interface LibraryData {
  songs: Track[];
  settings: LibrarySettings;
}

export interface LibraryIndexSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  coverUrl?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  lastModified?: number;
  addedAt?: string;
  playCount?: number;
  lastPlayed?: string | null;
  available?: boolean;
}

export interface LibraryIndexData {
  songs: LibraryIndexSong[];
  settings: LibrarySettings;
}

export interface LibrarySettings {
  volume?: number;
  autoScroll?: boolean;
  theme?: string;
  // 播放状态
  currentTrackIndex?: number;
  currentTrackId?: string;
  currentTime?: number;
  isPlaying?: boolean;
  playbackMode?: 'order' | 'shuffle' | 'repeat-one';
  [key: string]: any;
}

export interface ValidationResult {
  id: string;
  exists: boolean;
}

class LibraryStorageService {
  private saveTimer: NodeJS.Timeout | null = null;
  private saveDelay = 1000; // 防抖延迟：1秒

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
      const result = api.loadLibraryIndex ? await api.loadLibraryIndex() : await api.loadLibrary();

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
      const result = api.saveLibraryIndex ? await api.saveLibraryIndex(library) : await api.saveLibrary(library);

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
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(() => {
      this.saveLibrary(library);
      this.saveTimer = null;
    }, this.saveDelay);
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
