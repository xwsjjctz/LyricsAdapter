import type { RefObject } from 'react';

/**
 * Import-facing ViewModel (Phase 4 follow-up, roadmap §6.2 import domain).
 *
 * Repackages the import surface — useImportStore (file dialog, drop handling,
 * progress) + reload-unavailable-files behavior into the shape consumed by
 * the application shell.
 *
 * Thin composition only. The underlying store/hook stay untouched.
 */

export interface ImportViewModel {
  /** Hidden <input type="file"> ref owned by the application shell. */
  fileInputRef: RefObject<HTMLInputElement>;
  /** Import progress for the current view slot (null when idle). */
  importProgress: { loaded: number; total: number } | null;
  /** Whether import is disabled for the current view slot (e.g. read-only cloud). */
  importDisabled: boolean;

  /** Open the native file dialog for the current view slot. */
  importClick(): void;
  /** Handle dropped File objects (browser-mode fallback). */
  dropFiles(files: File[]): Promise<void>;
  /** Handle dropped file paths (Electron drag-drop). */
  dropFilePaths(filePaths: { path: string; name: string }[]): void;
  /** <input> change handler. */
  onFileInputChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void>;
  /** Re-scan unavailable files for the active slot (legacy Sidebar). */
  reloadFiles(): Promise<void>;
}

export interface ImportViewModelOptions {
  fileInputRef: RefObject<HTMLInputElement>;
  importProgress: { loaded: number; total: number } | null;
  importDisabled: boolean;
  importClick: () => void;
  dropFiles: (files: File[]) => Promise<void>;
  dropFilePaths: (filePaths: { path: string; name: string }[]) => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  reloadFiles: () => Promise<void>;
}

export function useImportViewModel(opts: ImportViewModelOptions): ImportViewModel {
  const {
    fileInputRef,
    importProgress,
    importDisabled,
    importClick,
    dropFiles,
    dropFilePaths,
    onFileInputChange,
    reloadFiles,
  } = opts;

  return {
    fileInputRef,
    importProgress,
    importDisabled,
    importClick,
    dropFiles,
    dropFilePaths,
    onFileInputChange,
    reloadFiles,
  };
}
