import { useCallback, useState } from 'react';
import type React from 'react';
import { logger } from '../services/logger';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '../services/desktopAdapter';
import { notifyImportTruncated, notifyNothingImportable } from '../services/importFeedback';
import { isImportableAudioName, type AudioPathScan } from '../shared/audioFormats';

interface DroppedPath {
  path: string;
  name: string;
}

interface DroppedEntry {
  file: File;
  isDirectory: boolean;
}

interface UseLibraryFileDropOptions {
  importDisabled: boolean;
  onDropFiles?: ((files: File[]) => void) | undefined;
  onDropFilePaths?: ((filePaths: DroppedPath[]) => void) | undefined;
}

interface LibraryFileDrop {
  /** An external file drag is over the list (drives the import overlay). */
  isDragging: boolean;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
}

/** The files and folders a drop carries; a folder also arrives as a `File`, which only its entry tells apart. */
function droppedEntries(transfer: DataTransfer): DroppedEntry[] {
  const items = transfer.items ? Array.from(transfer.items).filter(item => item.kind === 'file') : [];
  if (items.length === 0) {
    return transfer.files ? Array.from(transfer.files).map(file => ({ file, isDirectory: false })) : [];
  }
  return items.flatMap(item => {
    const file = item.getAsFile();
    return file ? [{ file, isDirectory: item.webkitGetAsEntry()?.isDirectory === true }] : [];
  });
}

function toDroppedPath(filePath: string): DroppedPath {
  return { path: filePath, name: filePath.split(/[/\\]/).pop() || '' };
}

/**
 * External audio-file and folder drops onto the library list. Desktop builds resolve
 * real paths through the bridge; the browser build falls back to File objects.
 * Internal row reordering is handled separately by the list itself.
 */
export function useLibraryFileDrop({
  importDisabled,
  onDropFiles,
  onDropFilePaths,
}: UseLibraryFileDropOptions): LibraryFileDrop {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (importDisabled) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    // Check if this is an external file drop (not internal track reordering)
    const hasFiles = e.dataTransfer.files.length > 0;
    const hasFileTypes = e.dataTransfer.types.some(type =>
      type === 'Files' || type === 'text/uri-list'
    );

    // Only show import overlay for external file drops
    if ((hasFiles || hasFileTypes) && !isDragging) {
      logger.debug('[LibraryView] Drag over - enabling dragging state');
      setIsDragging(true);
    }
  }, [isDragging, importDisabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set dragging to false if we're actually leaving the container
    // (not just hovering over child elements)
    const currentTarget = e.currentTarget as HTMLElement;
    const relatedTarget = e.relatedTarget as HTMLElement;

    // Check if the related target is outside the current target
    // relatedTarget is null when dragging leaves the window (e.g., to desktop)
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      logger.debug('[LibraryView] Drag leave - disabling dragging state');
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    logger.debug('[LibraryView] Drop event triggered');
    setIsDragging(false);
    if (importDisabled) return;

    // Read the transfer before any await: it is emptied once the event returns.
    const dropped = droppedEntries(e.dataTransfer);
    // An internal row or tile drag carries no files and is not an import.
    if (dropped.length === 0) return;

    const audioFiles = dropped
      .filter(entry => !entry.isDirectory && isImportableAudioName(entry.file.name))
      .map(entry => entry.file);
    const folders = dropped.filter(entry => entry.isDirectory).map(entry => entry.file);
    logger.debug(`[LibraryView] Dropped ${dropped.length} item(s): ${audioFiles.length} audio file(s), ${folders.length} folder(s)`);

    // Desktop: real paths through the bridge, with folders resolved to the audio beneath them.
    const desktopAPI = getDesktopAPI();
    if (desktopAPI?.getPathForFile && onDropFilePaths) {
      // Called on the adapter: it is a method and needs its receiver.
      const pathOf = (file: File): string => desktopAPI.getPathForFile!(file);
      let filePaths: DroppedPath[] | null = null;
      let folderPaths: string[] = [];
      try {
        filePaths = audioFiles.map(file => ({ path: pathOf(file), name: file.name }));
        folderPaths = folders.map(pathOf);
      } catch (error) {
        logger.error('[LibraryView] Failed to get file paths:', error);
        // Fall through to File mode
      }

      if (filePaths) {
        const scan: AudioPathScan = folderPaths.length > 0
          ? await desktopAPI.expandAudioPaths(folderPaths)
          : { filePaths: [], truncated: false };
        // A file dropped together with its own folder must not be imported twice.
        const byPath = new Map<string, DroppedPath>();
        for (const entry of [...filePaths, ...scan.filePaths.map(toDroppedPath)]) {
          if (!byPath.has(entry.path)) byPath.set(entry.path, entry);
        }
        const importable = [...byPath.values()];
        logger.debug(`[LibraryView] Got ${importable.length} file path(s)`);
        if (importable.length === 0) {
          notifyNothingImportable(t);
          return;
        }
        if (scan.truncated) notifyImportTruncated(t, importable.length);
        onDropFilePaths(importable);
        return;
      }
    }

    // Web mode or fallback: File objects, which cannot reach into folders.
    if (audioFiles.length === 0) {
      logger.warn('[LibraryView] No audio files dropped');
      notifyNothingImportable(t);
      return;
    }
    if (onDropFiles) {
      logger.debug(`[LibraryView] Web mode: passing ${audioFiles.length} File objects`);
      onDropFiles(audioFiles);
    } else {
      logger.warn('[LibraryView] No drop handler available');
    }
  }, [onDropFiles, onDropFilePaths, importDisabled, t]);

  return { isDragging, handleDragOver, handleDragLeave, handleDrop };
}
