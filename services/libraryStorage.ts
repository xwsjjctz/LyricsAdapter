/**
 * 音乐库持久化存储服务
 * 处理与 Electron 主进程的通信，实现数据的读写和验证
 */

import { Track } from '../types';

export interface LibraryData {
  songs: Track[];
  settings: LibrarySettings;
}

export interface LibrarySettings {
  volume?: number;
  autoScroll?: boolean;
  theme?: string;
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
  async loadLibrary(): Promise<LibraryData> {
    try {
      if (!this.isElectron()) {
        console.log('⚠️ Not running in Electron, skipping library load');
        return { songs: [], settings: {} };
      }

      console.log('📂 Loading library from disk...');
      const result = await (window as any).electron.loadLibrary();

      if (result.success) {
        console.log('✅ Library loaded successfully!');
        console.log(`   - ${result.library.songs?.length || 0} songs found`);
        if (result.library.songs?.length > 0) {
          console.log('   - First song:', result.library.songs[0].title);
        }
        return result.library;
      } else {
        console.error('❌ Failed to load library:', result.error);
        return { songs: [], settings: {} };
      }
    } catch (error) {
      console.error('❌ Error loading library:', error);
      return { songs: [], settings: {} };
    }
  }

  /**
   * 保存音乐库到磁盘
   */
  async saveLibrary(library: LibraryData): Promise<boolean> {
    try {
      if (!this.isElectron()) {
        console.log('⚠️ Not running in Electron, skipping library save');
        return false;
      }

      console.log('💾 Saving library to disk...');
      console.log(`   - ${library.songs.length} songs`);
      const result = await (window as any).electron.saveLibrary(library);

      if (result.success) {
        console.log('✅ Library saved successfully!');
        return true;
      } else {
        console.error('❌ Failed to save library:', result.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Error saving library:', error);
      return false;
    }
  }

  /**
   * 防抖保存：延迟执行保存操作，避免频繁写入
   */
  saveLibraryDebounced(library: LibraryData): void {
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
      if (!this.isElectron()) {
        return true; // Web 环境默认返回 true
      }

      return await (window as any).electron.validateFilePath(filePath);
    } catch (error) {
      console.error('Error validating file path:', error);
      return false;
    }
  }

  /**
   * 验证所有文件路径
   */
  async validateAllPaths(songs: Track[]): Promise<ValidationResult[]> {
    try {
      if (!this.isElectron()) {
        // Web 环境默认返回全部有效
        return songs.map(song => ({ id: song.id, exists: true }));
      }

      const result = await (window as any).electron.validateAllPaths(songs);

      if (result.success) {
        return result.results;
      } else {
        console.error('Failed to validate paths:', result.error);
        return songs.map(song => ({ id: song.id, exists: true }));
      }
    } catch (error) {
      console.error('Error validating paths:', error);
      return songs.map(song => ({ id: song.id, exists: true }));
    }
  }

  /**
   * 获取应用数据目录路径
   */
  async getAppDataPath(): Promise<string | null> {
    try {
      if (!this.isElectron()) {
        return null;
      }

      return await (window as any).electron.getAppDataPath();
    } catch (error) {
      console.error('Error getting app data path:', error);
      return null;
    }
  }

  /**
   * 检查是否在 Electron 环境中运行
   */
  private isElectron(): boolean {
    return !!(window as any).electron;
  }
}

// 导出单例实例
export const libraryStorage = new LibraryStorageService();
