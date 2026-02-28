/**
 * Desktop API adapter for Electron.
 */

// Import parseAudioFile for Electron compatibility
import { parseAudioFile as parseAudioFileSync } from './metadataService';
import { validateMetadataMap, type ValidatedMetadata } from './dataValidator';
import { logger } from './logger';

export interface DesktopAPI {
  platform: string;
  readFile: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; error?: string }>;
  checkFileExists: (filePath: string) => Promise<boolean>;
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  loadLibrary: () => Promise<{ success: boolean; library: unknown; error?: string }>;
  saveLibrary: (library: unknown) => Promise<{ success: boolean; error?: string }>;
  loadLibraryIndex?: () => Promise<{ success: boolean; library: unknown; error?: string }>;
  saveLibraryIndex?: (library: unknown) => Promise<{ success: boolean; error?: string }>;
  validateFilePath: (filePath: string) => Promise<boolean>;
  validateAllPaths: (songs: unknown[]) => Promise<{ success: boolean; results: unknown[]; error?: string }>;
  saveAudioFile: (sourcePath: string, fileName: string) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
  saveAudioFileFromBuffer: (fileName: string, fileData: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
  deleteAudioFile: (filePath: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
  cleanupOrphanAudio: (keepPaths: string[]) => Promise<{ success: boolean; removed?: number; error?: string }>;
  saveCoverThumbnail?: (payload: { id: string; data: string; mime: string }) => Promise<{ success: boolean; coverUrl?: string; filePath?: string; error?: string }>;
  deleteCoverThumbnail?: (trackId: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
  getAppDataPath: () => Promise<string | null>;
  loadMetadataCache: () => Promise<{ entries: Record<string, unknown> }>;
  saveMetadataCache: (cache: { entries: Record<string, unknown> }) => Promise<{ success: boolean; error?: string }>;
  getMetadataForSong: (songId: string) => Promise<unknown>;
  parseAudioMetadata: (filePath: string) => Promise<{ success: boolean; metadata?: unknown; error?: string }>;
  getPathForFile?: (file: File) => string;
  // Window control APIs
  minimizeWindow?: () => void;
  maximizeWindow?: () => void;
  closeWindow?: () => void;
  isMaximized?: () => boolean;
  // Settings APIs
  selectDownloadFolder?: () => Promise<{ success: boolean; path?: string; error?: string }>;
}

class ElectronAdapter implements DesktopAPI {
  private metadataCache: Record<string, ValidatedMetadata> = {};

  // Return actual OS platform from underlying API
  get platform(): string {
    return this.api.platform;
  }

  constructor(private api: DesktopAPI) {
    // Initialize with empty cache, will be loaded from IndexedDB if needed
    this.metadataCache = {};
  }

  async readFile(filePath: string): Promise<{ success: boolean; data: ArrayBuffer; error?: string }> {
    return this.api.readFile(filePath);
  }

  async checkFileExists(filePath: string): Promise<boolean> {
    return this.api.checkFileExists(filePath);
  }

  async selectFiles(): Promise<{ canceled: boolean; filePaths: string[] }> {
    return this.api.selectFiles();
  }

  async loadLibrary(): Promise<{ success: boolean; library: any; error?: string }> {
    return this.api.loadLibrary();
  }

  async saveLibrary(library: any): Promise<{ success: boolean; error?: string }> {
    return this.api.saveLibrary(library);
  }

  async loadLibraryIndex(): Promise<{ success: boolean; library: any; error?: string }> {
    if (typeof this.api.loadLibraryIndex === 'function') {
      return this.api.loadLibraryIndex();
    }
    return this.api.loadLibrary();
  }

  async saveLibraryIndex(library: any): Promise<{ success: boolean; error?: string }> {
    if (typeof this.api.saveLibraryIndex === 'function') {
      return this.api.saveLibraryIndex(library);
    }
    return this.api.saveLibrary(library);
  }

  async validateFilePath(filePath: string): Promise<boolean> {
    return this.api.validateFilePath(filePath);
  }

  async validateAllPaths(songs: any[]): Promise<{ success: boolean; results: any[]; error?: string }> {
    return this.api.validateAllPaths(songs);
  }

  async saveAudioFile(sourcePath: string, fileName: string): Promise<{ success: boolean; filePath?: string; method?: string; error?: string }> {
    return this.api.saveAudioFile(sourcePath, fileName);
  }

  async saveAudioFileFromBuffer(fileName: string, fileData: ArrayBuffer): Promise<{ success: boolean; filePath?: string; method?: string; error?: string }> {
    return this.api.saveAudioFileFromBuffer(fileName, fileData);
  }

  async deleteAudioFile(filePath: string): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
    return this.api.deleteAudioFile(filePath);
  }

  async cleanupOrphanAudio(keepPaths: string[]): Promise<{ success: boolean; removed?: number; error?: string }> {
    return this.api.cleanupOrphanAudio(keepPaths);
  }

  async saveCoverThumbnail(payload: { id: string; data: string; mime: string }): Promise<{ success: boolean; coverUrl?: string; filePath?: string; error?: string }> {
    if (typeof this.api.saveCoverThumbnail === 'function') {
      return this.api.saveCoverThumbnail(payload);
    }
    return { success: false, error: 'saveCoverThumbnail not available' };
  }

  async deleteCoverThumbnail(trackId: string): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
    if (typeof this.api.deleteCoverThumbnail === 'function') {
      return this.api.deleteCoverThumbnail(trackId);
    }
    return { success: false, error: 'deleteCoverThumbnail not available' };
  }

  async getAppDataPath(): Promise<string | null> {
    return this.api.getAppDataPath();
  }

  async loadMetadataCache(): Promise<{ entries: Record<string, any> }> {
    // Return in-memory cache
    return { entries: this.metadataCache };
  }

  async saveMetadataCache(cache: { entries: Record<string, unknown> }): Promise<{ success: boolean; error?: string }> {
    // Update local cache only (persistence is handled by metadataCacheService via IndexedDB)
    this.metadataCache = validateMetadataMap(cache.entries);
    return { success: true };
  }

  async getMetadataForSong(songId: string): Promise<unknown> {
    // Return from in-memory cache
    return this.metadataCache[songId] || null;
  }

  async parseAudioMetadata(filePath: string): Promise<{ success: boolean; metadata?: unknown; error?: string }> {
    // Electron: Use JS-side parsing with proper cover extraction
    try {
      const readResult = await this.api.readFile(filePath);
      if (readResult.success && readResult.data) {
        const fileData = new Uint8Array(readResult.data);
        const fileName = filePath.split(/[/\\]/).pop() || 'audio.mp3';
        
        // Determine MIME type based on file extension
        const lowerName = fileName.toLowerCase();
        let mimeType = 'audio/mpeg'; // default to MP3
        if (lowerName.endsWith('.flac')) {
          mimeType = 'audio/flac';
        } else if (lowerName.endsWith('.m4a') || lowerName.endsWith('.mp4')) {
          mimeType = 'audio/mp4';
        }
        
        const file = new File([fileData], fileName, { type: mimeType });

        // Parse metadata using JS parser
        const metadata = await parseAudioFileSync(file);

        // Convert cover URL to base64 if available
        let coverData: string | undefined;
        let coverMime: string | undefined;

        if (metadata.coverUrl && !metadata.coverUrl.startsWith('http')) {
          try {
            // Convert blob URL to base64 directly
            const response = await fetch(metadata.coverUrl);
            const blob = await response.blob();

            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });

            // Extract mime type from data URL (format: data:image/jpeg;base64,...)
            const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
            if (mimeMatch) {
              coverMime = mimeMatch[1];
              // Extract base64 data (remove the data:image/xxx;base64, prefix)
              const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
              if (base64Match) {
                coverData = base64Match[1];
              }
            }
          } catch (e) {
            logger.warn('[ElectronAdapter] Failed to convert cover to base64:', e);
          }
        }

        return {
          success: true,
          metadata: {
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            duration: metadata.duration,
            lyrics: metadata.lyrics,
            syncedLyrics: metadata.syncedLyrics,
            coverData: coverData,
            coverMime: coverMime,
            fileSize: fileData.length,
          }
        };
      }

      return { success: false, error: 'Failed to read file' };
    } catch (error) {
      logger.error('[ElectronAdapter] parseAudioMetadata error:', error);
      return { success: false, error: String(error) };
    }
  }

  async selectDownloadFolder(): Promise<{ success: boolean; path?: string; error?: string }> {
    if (typeof this.api.selectDownloadFolder === 'function') {
      return this.api.selectDownloadFolder();
    }
    return { success: false, error: 'selectDownloadFolder not available' };
  }

  // Window control methods
  minimizeWindow(): void {
    if (typeof this.api.minimizeWindow === 'function') {
      this.api.minimizeWindow();
    }
  }

  maximizeWindow(): void {
    if (typeof this.api.maximizeWindow === 'function') {
      this.api.maximizeWindow();
    }
  }

  closeWindow(): void {
    if (typeof this.api.closeWindow === 'function') {
      this.api.closeWindow();
    }
  }

  isMaximized(): boolean {
    if (typeof this.api.isMaximized === 'function') {
      const result = this.api.isMaximized();
      // Handle both sync and async results
      if (typeof result === 'boolean') {
        return result;
      }
      // For async, return false initially (state will be updated via effect)
      return false;
    }
    return false;
  }

  getPathForFile(file: File): string {
    if (typeof this.api.getPathForFile === 'function') {
      return this.api.getPathForFile(file);
    }
    throw new Error('getPathForFile not available');
  }

}

let desktopAPI: DesktopAPI | null = null;

function createElectronAdapter(): ElectronAdapter | null {
  if (typeof window !== 'undefined' && window.electron) {
    return new ElectronAdapter(window.electron);
  }
  return null;
}

export function getDesktopAPI(): DesktopAPI | null {
  if (desktopAPI) {
    logger.debug('[DesktopAdapter] Returning cached desktopAPI, platform:', desktopAPI.platform);
    return desktopAPI;
  }

  const electronAdapter = createElectronAdapter();
  if (electronAdapter) {
    logger.debug('[DesktopAdapter] ✓ Electron adapter created');
    desktopAPI = electronAdapter;
    return desktopAPI;
  }

  logger.debug('[DesktopAdapter] No desktop adapter available (running in browser)');
  return null;
}

// Async version for when you need to wait for initialization
export async function getDesktopAPIAsync(): Promise<DesktopAPI | null> {
  return getDesktopAPI();
}

export function isDesktop(): boolean {
  return getDesktopAPI() !== null;
}
