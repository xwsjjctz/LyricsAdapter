/**
 * Desktop API adapter for both Electron and Tauri
 */

// Import parseAudioFile for Electron compatibility
import { parseAudioFile as parseAudioFileSync } from './metadataService';

export interface DesktopAPI {
  platform: string;
  readFile: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; error?: string }>;
  checkFileExists: (filePath: string) => Promise<boolean>;
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  loadLibrary: () => Promise<{ success: boolean; library: any; error?: string }>;
  saveLibrary: (library: any) => Promise<{ success: boolean; error?: string }>;
  validateFilePath: (filePath: string) => Promise<boolean>;
  validateAllPaths: (songs: any[]) => Promise<{ success: boolean; results: any[]; error?: string }>;
  saveAudioFile: (sourcePath: string, fileName: string) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
  saveAudioFileFromBuffer: (fileName: string, fileData: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
  deleteAudioFile: (filePath: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
  getAppDataPath: () => Promise<string | null>;
  loadMetadataCache: () => Promise<{ entries: Record<string, any> }>;
  saveMetadataCache: (cache: { entries: Record<string, any> }) => Promise<{ success: boolean; error?: string }>;
  getMetadataForSong: (songId: string) => Promise<any>;
  parseAudioMetadata: (filePath: string) => Promise<{ success: boolean; metadata?: any; error?: string }>;
  getAudioUrl: (filePath: string) => Promise<string>;
}

// Use a string literal to prevent Vite from analyzing the import
const IMPORT_TAURI_CORE = '@tauri-apps/api/core';
const IMPORT_TAURI_DIALOG = '@tauri-apps/plugin-dialog';

class TauriAdapter implements DesktopAPI {
  platform = 'tauri';
  private invokeCache: any = null;

  private async invoke(cmd: string, args?: any) {
    try {
      // Cache the invoke function after first access
      if (!this.invokeCache) {
        console.log('[TauriAdapter] Getting invoke function from Tauri...');

        // Try to get invoke from different possible locations
        const windowObj = window as any;

        // Debug: Log the structure of __TAURI_INTERNALS__
        console.log('[TauriAdapter] __TAURI_INTERNALS__ exists:', !!windowObj.__TAURI_INTERNALS__);
        console.log('[TauriAdapter] __TAURI_INTERNALS__ keys:', windowObj.__TAURI_INTERNALS__ ? Object.keys(windowObj.__TAURI_INTERNALS__) : 'N/A');

        // Try to find the RPC channel or invoke function
        if (windowObj.__TAURI_INTERNALS__) {
          const internals = windowObj.__TAURI_INTERNALS__;

          // Log all nested paths
          console.log('[TauriAdapter] Checking nested structures...');
          for (const key of Object.keys(internals)) {
            console.log(`[TauriAdapter] __TAURI_INTERNALS__.${key}:`, typeof internals[key]);
            if (internals[key] && typeof internals[key] === 'object') {
              console.log(`[TauriAdapter] __TAURI_INTERNALS__.${key} keys:`, Object.keys(internals[key]));
            }
          }

          // Tauri 2.x: Try to find invoke in various locations
          if (typeof internals.core?.invoke === 'function') {
            this.invokeCache = internals.core.invoke;
            console.log('[TauriAdapter] ✓ Found invoke in __TAURI_INTERNALS__.core.invoke');
          } else if (typeof internals.invoke === 'function') {
            this.invokeCache = internals.invoke;
            console.log('[TauriAdapter] ✓ Found invoke in __TAURI_INTERNALS__.invoke');
          } else if (typeof internals.rpc?.invoke === 'function') {
            this.invokeCache = internals.rpc.invoke;
            console.log('[TauriAdapter] ✓ Found invoke in __TAURI_INTERNALS__.rpc.invoke');
          } else if (typeof internals.app?.invoke === 'function') {
            this.invokeCache = internals.app.invoke;
            console.log('[TauriAdapter] ✓ Found invoke in __TAURI_INTERNALS__.app.invoke');
          }
        }

        // If still not found, try __TAURI__ object
        if (!this.invokeCache && windowObj.__TAURI__) {
          console.log('[TauriAdapter] Checking __TAURI__ object...');
          if (typeof windowObj.__TAURI__.core?.invoke === 'function') {
            this.invokeCache = windowObj.__TAURI__.core.invoke;
            console.log('[TauriAdapter] ✓ Found invoke in __TAURI__.core.invoke');
          } else if (typeof windowObj.__TAURI__.invoke === 'function') {
            this.invokeCache = windowObj.__TAURI__.invoke;
            console.log('[TauriAdapter] ✓ Found invoke in __TAURI__.invoke');
          }
        }

        // If still not found, try direct import
        if (!this.invokeCache) {
          console.log('[TauriAdapter] Trying direct import of @tauri-apps/api/core...');
          try {
            const tauriCore = await import(/* @vite-ignore */ IMPORT_TAURI_CORE);
            if (typeof tauriCore.invoke === 'function') {
              this.invokeCache = tauriCore.invoke;
              console.log('[TauriAdapter] ✓ Found invoke via import');
            } else {
              console.error('[TauriAdapter] @tauri-apps/api/core loaded but no invoke function found');
              console.log('[TauriAdapter] @tauri-apps/api/core exports:', Object.keys(tauriCore));
            }
          } catch (importError) {
            console.error('[TauriAdapter] Failed to import @tauri-apps/api/core:', importError);
          }
        }

        if (!this.invokeCache) {
          throw new Error('Unable to find Tauri invoke function. Are you running in a Tauri environment?');
        }

        console.log('[TauriAdapter] ✓ Invoke function ready');
      }

      console.log(`[TauriAdapter] Invoking command: ${cmd}`, args);
      const result = await this.invokeCache(cmd, args);
      console.log(`[TauriAdapter] ✓ Command ${cmd} completed, result:`, result);
      console.log(`[TauriAdapter] Result type:`, typeof result);
      console.log(`[TauriAdapter] Result keys:`, result ? Object.keys(result) : 'N/A');
      return result;
    } catch (error) {
      console.error(`[TauriAdapter] ✗ Failed to invoke command ${cmd}:`, error);
      throw error;
    }
  }

  async readFile(filePath: string): Promise<{ success: boolean; data: ArrayBuffer; error?: string }> {
    console.log('[TauriAdapter] readFile called for:', filePath);
    const result = await this.invoke('read_file', { filePath });
    console.log('[TauriAdapter] read_file result:', result);
    console.log('[TauriAdapter] result.data type:', typeof result.data);
    console.log('[TauriAdapter] result.data constructor:', result.data?.constructor?.name);
    console.log('[TauriAdapter] result.data length:', result.data?.length);

    // Check if data is valid
    if (!result.data || result.data.length === 0) {
      console.error('[TauriAdapter] Data is empty or invalid!');
      return {
        success: false,
        data: new ArrayBuffer(0),
        error: result.error || 'Data is empty'
      };
    }

    // Convert Uint8Array to ArrayBuffer
    let arrayBuffer: ArrayBuffer;
    if (result.data instanceof Uint8Array) {
      // Direct access to the underlying ArrayBuffer
      arrayBuffer = result.data.buffer;
      console.log('[TauriAdapter] Using Uint8Array.buffer, byteLength:', arrayBuffer.byteLength);
    } else if (Array.isArray(result.data)) {
      // If it's a plain array, convert to Uint8Array first
      const uint8Array = new Uint8Array(result.data);
      arrayBuffer = uint8Array.buffer;
      console.log('[TauriAdapter] Converted array to Uint8Array, byteLength:', arrayBuffer.byteLength);
    } else {
      console.error('[TauriAdapter] Unknown data type:', result.data);
      return {
        success: false,
        data: new ArrayBuffer(0),
        error: 'Unknown data type'
      };
    }

    return {
      success: result.success,
      data: arrayBuffer,
      error: result.error
    };
  }

  async checkFileExists(filePath: string): Promise<boolean> {
    return await this.invoke('check_file_exists', { filePath });
  }

  async selectFiles(): Promise<{ canceled: boolean; filePaths: string[] }> {
    try {
      console.log('[TauriAdapter] Selecting files...');
      const windowObj = window as any;

      // Debug: Check what's available in __TAURI_INTERNALS__
      console.log('[TauriAdapter] __TAURI_INTERNALS__ structure:', {
        hasPlugins: !!windowObj.__TAURI_INTERNALS__?.plugins,
        pluginsKeys: windowObj.__TAURI_INTERNALS__?.plugins ? Object.keys(windowObj.__TAURI_INTERNALS__.plugins) : [],
        hasDialog: !!windowObj.__TAURI_INTERNALS__?.dialog,
        hasInvoke: !!windowObj.__TAURI_INTERNALS__?.invoke,
      });

      // Method 1: Try to invoke dialog plugin via invoke
      // In Tauri 2.x, plugins are called through the invoke function
      if (windowObj.__TAURI_INTERNALS__?.invoke) {
        console.log('[TauriAdapter] Trying to use invoke for dialog...');

        // Use the invoke function to call the dialog plugin
        try {
          const invokeFn = windowObj.__TAURI_INTERNALS__.invoke;

          // Tauri 2.x dialog plugin format - options must be wrapped in 'options' key
          const result = await invokeFn('plugin:dialog|open', {
            options: {
              multiple: true,
              filters: [{
                name: 'Audio',
                extensions: ['flac', 'mp3', 'm4a', 'wav']
              }]
            }
          });

          console.log('[TauriAdapter] ✓ Dialog opened via invoke, result:', result);

          if (result === null) {
            return { canceled: true, filePaths: [] };
          }

          const filePaths = Array.isArray(result) ? result : [result];
          return { canceled: false, filePaths };
        } catch (invokeError) {
          console.warn('[TauriAdapter] Dialog via invoke failed, trying other methods:', invokeError);
        }
      }

      // Method 2: Try direct import with @vite-ignore comment (might work in some configurations)
      try {
        console.log('[TauriAdapter] Trying direct import of @tauri-apps/plugin-dialog...');
        // Use @vite-ignore to suppress Vite warning
        const dialogModule = await import(/* @vite-ignore */ IMPORT_TAURI_DIALOG);
        if (dialogModule.open) {
          const selected = await dialogModule.open({
            multiple: true,
            filters: [{
              name: 'Audio',
              extensions: ['flac', 'mp3', 'm4a', 'wav']
            }]
          });

          if (selected === null) {
            return { canceled: true, filePaths: [] };
          }

          const filePaths = Array.isArray(selected) ? selected : [selected];
          return { canceled: false, filePaths };
        }
      } catch (importError) {
        console.warn('[TauriAdapter] Direct import failed:', importError);
      }

      console.error('[TauriAdapter] All methods to open dialog failed');
      return { canceled: true, filePaths: [] };
    } catch (error) {
      console.error('[TauriAdapter] Failed to select files:', error);
      return { canceled: true, filePaths: [] };
    }
  }

  async loadLibrary(): Promise<{ success: boolean; library: any; error?: string }> {
    console.log('[TauriAdapter] Invoking load_library command...');
    try {
      const result = await this.invoke('load_library');
      console.log('[TauriAdapter] load_library result:', result);
      return result;
    } catch (error) {
      console.error('[TauriAdapter] load_library error:', error);
      throw error;
    }
  }

  async saveLibrary(library: any): Promise<{ success: boolean; error?: string }> {
    console.log('[TauriAdapter] Invoking save_library command...');
    console.log('[TauriAdapter] Library data:', library);
    try {
      const result = await this.invoke('save_library', { library });
      console.log('[TauriAdapter] save_library result:', result);
      return result;
    } catch (error) {
      console.error('[TauriAdapter] save_library error:', error);
      throw error;
    }
  }

  async validateFilePath(filePath: string): Promise<boolean> {
    return await this.invoke('validate_file_path', { filePath });
  }

  async validateAllPaths(songs: any[]): Promise<{ success: boolean; results: any[]; error?: string }> {
    return await this.invoke('validate_all_paths', { songs });
  }

  async saveAudioFile(sourcePath: string, fileName: string): Promise<{ success: boolean; filePath?: string; method?: string; error?: string }> {
    return await this.invoke('save_audio_file', { sourcePath, fileName });
  }

  async saveAudioFileFromBuffer(fileName: string, fileData: ArrayBuffer): Promise<{ success: boolean; filePath?: string; method?: string; error?: string }> {
    return await this.invoke('save_audio_file_from_buffer', {
      fileName,
      fileData: Array.from(new Uint8Array(fileData))
    });
  }

  async deleteAudioFile(filePath: string): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
    return await this.invoke('delete_audio_file', { filePath });
  }

  async getAppDataPath(): Promise<string | null> {
    try {
      return await this.invoke('get_app_data_path');
    } catch {
      return null;
    }
  }

  async loadMetadataCache(): Promise<{ entries: Record<string, any> }> {
    return await this.invoke('load_metadata_cache');
  }

  async saveMetadataCache(cache: { entries: Record<string, any> }): Promise<{ success: boolean; error?: string }> {
    return await this.invoke('save_metadata_cache', { cache });
  }

  async getMetadataForSong(songId: string): Promise<any> {
    return await this.invoke('get_metadata_for_song', { songId });
  }

  async parseAudioMetadata(filePath: string): Promise<{ success: boolean; metadata?: any; error?: string }> {
    return await this.invoke('parse_audio_metadata', { filePath });
  }

  async getAudioUrl(filePath: string): Promise<string> {
    console.log('[TauriAdapter] Getting audio URL for:', filePath);

    // Call Rust command to get asset URL
    try {
      const assetUrl = await this.invoke('get_audio_url', { filePath });
      console.log('[TauriAdapter] ✓ Got asset URL:', assetUrl);
      return assetUrl;
    } catch (error) {
      console.error('[TauriAdapter] Failed to get audio URL:', error);
      throw error;
    }
  }
}

class ElectronAdapter implements DesktopAPI {
  platform = 'electron';
  private metadataCache: Record<string, any> = {};

  constructor(private api: any) {
    // Try to load cache from localStorage (Electron-specific)
    try {
      const savedCache = localStorage.getItem('electron_metadata_cache');
      if (savedCache) {
        this.metadataCache = JSON.parse(savedCache);
        console.log('[ElectronAdapter] Loaded cache from localStorage:', Object.keys(this.metadataCache).length, 'entries');
      }
    } catch (e) {
      console.warn('[ElectronAdapter] Failed to load cache from localStorage:', e);
    }
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

  async getAppDataPath(): Promise<string | null> {
    return this.api.getAppDataPath();
  }

  async loadMetadataCache(): Promise<{ entries: Record<string, any> }> {
    // Return in-memory cache
    return { entries: this.metadataCache };
  }

  async saveMetadataCache(cache: { entries: Record<string, any> }): Promise<{ success: boolean; error?: string }> {
    // Update local cache
    this.metadataCache = cache.entries;

    // Persist to localStorage
    try {
      localStorage.setItem('electron_metadata_cache', JSON.stringify(cache.entries));
      console.log('[ElectronAdapter] Saved cache to localStorage:', Object.keys(cache.entries).length, 'entries');
      return { success: true };
    } catch (e) {
      console.error('[ElectronAdapter] Failed to save cache to localStorage:', e);
      return { success: false, error: String(e) };
    }
  }

  async getMetadataForSong(songId: string): Promise<any> {
    // Return from in-memory cache
    return this.metadataCache[songId] || null;
  }

  async parseAudioMetadata(filePath: string): Promise<{ success: boolean; metadata?: any; error?: string }> {
    // Electron: Use JS-side parsing with proper cover extraction
    try {
      const readResult = await this.api.readFile(filePath);
      if (readResult.success && readResult.data) {
        const fileData = new Uint8Array(readResult.data);
        const fileName = filePath.split(/[/\\]/).pop() || 'audio.flac';
        const file = new File([fileData], fileName, { type: 'audio/flac' });

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
            console.warn('[ElectronAdapter] Failed to convert cover to base64:', e);
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
          }
        };
      }

      return { success: false, error: 'Failed to read file' };
    } catch (error) {
      console.error('[ElectronAdapter] parseAudioMetadata error:', error);
      return { success: false, error: String(error) };
    }
  }

  async getAudioUrl(filePath: string): Promise<string> {
    // Electron should have its own implementation
    return filePath; // Return file path as-is
  }
}

let desktopAPI: DesktopAPI | null = null;
let initPromise: Promise<DesktopAPI | null> | null = null;

// Lazy initialization to avoid importing Tauri modules in non-Tauri environments
async function createTauriAdapter(): Promise<TauriAdapter | null> {
  try {
    if (typeof window !== 'undefined') {
      console.log('[DesktopAdapter] Checking for Tauri environment...');

      // Check for Tauri-specific global objects
      const windowObj = window as any;

      // Tauri 2.x uses different global objects
      const hasTauriAPI =
        windowObj.__TAURI_INTERNALS__ ||
        windowObj.__TAURI__ ||
        // Check if we're in a Tauri window by examining the user agent
        navigator.userAgent.includes('Tauri');

      if (hasTauriAPI) {
        console.log('[DesktopAdapter] ✓ Tauri environment detected');
        console.log('[DesktopAdapter] __TAURI_INTERNALS__:', !!windowObj.__TAURI_INTERNALS__);
        console.log('[DesktopAdapter] __TAURI__:', !!windowObj.__TAURI__);
        console.log('[DesktopAdapter] UserAgent has Tauri:', navigator.userAgent.includes('Tauri'));

        // Try to verify by actually importing the API
        try {
          // Use a simple direct import - it should work because @tauri-apps/api is marked as external
          // We need to use the __TAURI__ internal API directly
          if (windowObj.__TAURI_INTERNALS__) {
            console.log('[DesktopAdapter] ✓ Using __TAURI_INTERNALS__');
            console.log('[DesktopAdapter] ✓ Tauri adapter initialized');
            return new TauriAdapter();
          }
        } catch (verifyError) {
          console.warn('[DesktopAdapter] Tauri detected but API verification failed:', verifyError);
        }

        console.log('[DesktopAdapter] ✓ Tauri adapter initialized (fallback)');
        return new TauriAdapter();
      }

      console.log('[DesktopAdapter] ✗ Not in Tauri environment');
    }
  } catch (e) {
    console.warn('[DesktopAdapter] Failed to initialize Tauri adapter:', e);
  }
  console.log('[DesktopAdapter] ✗ Tauri adapter not initialized');
  return null;
}

function createElectronAdapter(): ElectronAdapter | null {
  if (typeof window !== 'undefined' && (window as any).electron) {
    return new ElectronAdapter((window as any).electron);
  }
  return null;
}

// Initialize desktop API asynchronously
async function initializeDesktopAPI(): Promise<DesktopAPI | null> {
  if (desktopAPI) {
    return desktopAPI;
  }

  if (initPromise) {
    return initPromise;
  }

  console.log('[DesktopAdapter] Initializing desktop API...');

  initPromise = (async () => {
    // Try Electron first (synchronous check)
    const electronAdapter = createElectronAdapter();
    if (electronAdapter) {
      console.log('[DesktopAdapter] ✓ Using Electron adapter');
      desktopAPI = electronAdapter;
      return desktopAPI;
    }

    // Try Tauri (asynchronous check)
    const tauriAdapter = await createTauriAdapter();
    if (tauriAdapter) {
      console.log('[DesktopAdapter] ✓ Using Tauri adapter');
      desktopAPI = tauriAdapter;
      return desktopAPI;
    }

    console.log('[DesktopAdapter] No desktop adapter available (running in browser)');
    return null;
  })();

  return initPromise;
}

export function getDesktopAPI(): DesktopAPI | null {
  if (desktopAPI) {
    console.log('[DesktopAdapter] Returning cached desktopAPI, platform:', desktopAPI.platform);
    return desktopAPI;
  }

  // For Electron, we can create the adapter synchronously
  // since window.electron is immediately available
  const electronAdapter = createElectronAdapter();
  if (electronAdapter) {
    console.log('[DesktopAdapter] ✓ Electron adapter created synchronously');
    desktopAPI = electronAdapter;
    return desktopAPI;
  }

  // For Tauri, trigger async initialization and return null
  // Callers should use getDesktopAPIAsync() for Tauri
  console.log('[DesktopAdapter] Tauri environment detected, triggering async initialization...');
  initializeDesktopAPI().then(api => {
    if (api) {
      console.log('[DesktopAdapter] Desktop API initialized asynchronously, platform:', api.platform);
    }
  });
  return null;
}

// Async version for when you need to wait for initialization
export async function getDesktopAPIAsync(): Promise<DesktopAPI | null> {
  return await initializeDesktopAPI();
}

export function isDesktop(): boolean {
  return getDesktopAPI() !== null;
}
