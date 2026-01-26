/**
 * Desktop API adapter for both Electron and Tauri
 */

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
}

// Use a string literal to prevent Vite from analyzing the import
const IMPORT_TAURI_CORE = '@tauri-apps/api/core';
const IMPORT_TAURI_DIALOG = '@tauri-apps/plugin-dialog';

class TauriAdapter implements DesktopAPI {
  platform = 'tauri';

  private async invoke(cmd: string, args?: any) {
    // Use function constructor to hide import from static analysis
    const dynamicImport = new Function('module', 'return import(module)');
    const { invoke } = await dynamicImport(IMPORT_TAURI_CORE);
    return invoke(cmd, args);
  }

  async readFile(filePath: string): Promise<{ success: boolean; data: ArrayBuffer; error?: string }> {
    const result = await this.invoke('read_file', { filePath });
    return {
      success: result.success,
      data: result.data.buffer,
      error: result.error
    };
  }

  async checkFileExists(filePath: string): Promise<boolean> {
    return await this.invoke('check_file_exists', { filePath });
  }

  async selectFiles(): Promise<{ canceled: boolean; filePaths: string[] }> {
    const dynamicImport = new Function('module', 'return import(module)');
    const { open } = await dynamicImport(IMPORT_TAURI_DIALOG);
    const selected = await open({
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

  async loadLibrary(): Promise<{ success: boolean; library: any; error?: string }> {
    return await this.invoke('load_library');
  }

  async saveLibrary(library: any): Promise<{ success: boolean; error?: string }> {
    return await this.invoke('save_library', { library });
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
}

class ElectronAdapter implements DesktopAPI {
  platform = 'electron';

  constructor(private api: any) {}

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
}

let desktopAPI: DesktopAPI | null = null;

// Lazy initialization to avoid importing Tauri modules in non-Tauri environments
function createTauriAdapter(): TauriAdapter | null {
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      return new TauriAdapter();
    }
  } catch (e) {
    console.warn('Failed to initialize Tauri adapter:', e);
  }
  return null;
}

function createElectronAdapter(): ElectronAdapter | null {
  if (typeof window !== 'undefined' && (window as any).electron) {
    return new ElectronAdapter((window as any).electron);
  }
  return null;
}

export function getDesktopAPI(): DesktopAPI | null {
  if (desktopAPI) {
    return desktopAPI;
  }

  // Try Tauri first
  desktopAPI = createTauriAdapter();
  if (desktopAPI) {
    return desktopAPI;
  }

  // Fallback to Electron
  desktopAPI = createElectronAdapter();
  return desktopAPI;
}

export function isDesktop(): boolean {
  return getDesktopAPI() !== null;
}
