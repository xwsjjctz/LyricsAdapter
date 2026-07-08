import type { RefObject } from 'react';
import type { SlotId } from '../types';

/**
 * Import-facing ViewModel (Phase 4 follow-up, roadmap §6.2 import domain).
 *
 * Repackages the import surface — useImportStore (file dialog, drop handling,
 * progress) + the slot-aware "import into a specific slot" wrapper + the
 * reload-unavailable-files hook — into a single object both shells consume.
 *
 * Thin composition only. The underlying store/hook stay untouched.
 */

export interface ImportViewModel {
  /** Hidden <input type="file"> ref shared by both shells. */
  fileInputRef: RefObject<HTMLInputElement>;
  /** Import progress for the current view slot (null when idle). */
  importProgress: { loaded: number; total: number } | null;
  /** Whether import is disabled for the current view slot (e.g. read-only cloud). */
  importDisabled: boolean;

  /** Open the native file dialog for the current view slot. */
  importClick(): void;
  /** Switch to `slotId` then trigger import (used by New-UI slot cards). */
  importIntoSlot(slotId: SlotId): Promise<void>;
  /** Handle dropped File objects (browser-mode fallback). */
  dropFiles(files: File[]): Promise<void>;
  /** Handle dropped file paths (Electron drag-drop). */
  dropFilePaths(filePaths: { path: string; name: string }[]): void;
  /** <input> change handler. */
  onFileInputChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void>;
  /** Re-scan unavailable files for the active slot (legacy Sidebar). */
  reloadFiles(): Promise<void>;
  /** Re-scan unavailable local files (New-UI "reload unavailable"). */
  reloadUnavailable(): Promise<void>;
}

export interface ImportViewModelOptions {
  fileInputRef: RefObject<HTMLInputElement>;
  importProgress: { loaded: number; total: number } | null;
  importDisabled: boolean;
  importClick: () => void;
  importIntoSlot: (slotId: SlotId) => Promise<void>;
  dropFiles: (files: File[]) => Promise<void>;
  dropFilePaths: (filePaths: { path: string; name: string }[]) => void;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  reloadFiles: () => Promise<void>;
  reloadUnavailable: () => Promise<void>;
}

export function useImportViewModel(opts: ImportViewModelOptions): ImportViewModel {
  const {
    fileInputRef,
    importProgress,
    importDisabled,
    importClick,
    importIntoSlot,
    dropFiles,
    dropFilePaths,
    onFileInputChange,
    reloadFiles,
    reloadUnavailable,
  } = opts;

  return {
    fileInputRef,
    importProgress,
    importDisabled,
    importClick,
    importIntoSlot,
    dropFiles,
    dropFilePaths,
    onFileInputChange,
    reloadFiles,
    reloadUnavailable,
  };
}
