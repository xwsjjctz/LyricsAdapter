/**
 * 音乐库持久化存储服务
 * 处理与 Electron 主进程的通信，实现数据的读写和验证
 */

import { Track } from '../types';
import { getDesktopAPIAsync, isDesktop } from './desktopAdapter';
import { indexedDBStorage } from './indexedDBStorage';
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
        logger.debug('[LibraryStorage] ⚠️ Not running in Desktop mode, skipping library load');
        return { songs: [], settings: {} };
      }

      logger.debug('[LibraryStorage] 📂 Loading library from disk...');
      const result = api.loadLibraryIndex ? await api.loadLibraryIndex() : await api.loadLibrary();

      if (result.success) {
        logger.debug('[LibraryStorage] ✅ Library loaded successfully!');
        logger.debug(`[LibraryStorage]    - ${result.library.songs?.length || 0} songs found`);
        logger.debug('[LibraryStorage]    - Settings:', result.library.settings);

        // Check if any songs are missing lyrics, try to supplement from IndexedDB
        const songsNeedLyrics = result.library.songs?.some(s => !s.lyrics || !s.syncedLyrics);
        if (songsNeedLyrics && isDesktop()) {
          logger.debug('[LibraryStorage] Some songs missing lyrics, checking IndexedDB...');
          try {
            const idbLibrary = await indexedDBStorage.loadLibrary();
            if (idbLibrary && idbLibrary.songs && idbLibrary.songs.length > 0) {
              // Merge lyrics from IndexedDB
              const idbMap = new Map(idbLibrary.songs.map(s => [s.id, s]));
              result.library.songs = result.library.songs.map(song => {
                const idbSong = idbMap.get(song.id);
                if (idbSong && (song.lyrics !== idbSong.lyrics || song.syncedLyrics !== idbSong.syncedLyrics)) {
                  logger.debug(`[LibraryStorage] ✅ Supplementing lyrics for: ${song.title}`);
                  return {
                    ...song,
                    lyrics: song.lyrics || idbSong.lyrics || '',
                    syncedLyrics: song.syncedLyrics || idbSong.syncedLyrics
                  };
                }
                return song;
              });
            }
          } catch (err) {
            logger.warn('[LibraryStorage] Failed to check IndexedDB for lyrics:', err);
          }
        }

        return result.library;
      } else {
        logger.error('[LibraryStorage] ❌ Failed to load library:', result.error);
        return { songs: [], settings: {} };
      }
    } catch (error) {
      logger.error('[LibraryStorage] ❌ Error loading library:', error);
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
        logger.debug('⚠️ Not running in Desktop mode, skipping library save');
        return false;
      }

      logger.debug('💾 Saving library to disk...');
      logger.debug(`   - ${library.songs.length} songs`);
      const result = api.saveLibraryIndex ? await api.saveLibraryIndex(library) : await api.saveLibrary(library);

      if (result.success) {
        logger.debug('✅ Library saved successfully!');
        return true;
      } else {
        logger.error('❌ Failed to save library:', result.error);
        return false;
      }
    } catch (error) {
      logger.error('❌ Error saving library:', error);
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
        return true; // Web 环境默认返回 true
      }

      return await api.validateFilePath(filePath);
    } catch (error) {
      logger.error('Error validating file path:', error);
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
        // Web 环境默认返回全部有效
        return songs.map(song => ({ id: song.id, exists: true }));
      }

      const result = await api.validateAllPaths(songs);

      if (result.success) {
        return result.results;
      } else {
        logger.error('Failed to validate paths:', result.error);
        return songs.map(song => ({ id: song.id, exists: true }));
      }
    } catch (error) {
      logger.error('Error validating paths:', error);
      return songs.map(song => ({ id: song.id, exists: true }));
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
      logger.error('Error getting app data path:', error);
      return null;
    }
  }
}

// 导出单例实例
export const libraryStorage = new LibraryStorageService();
