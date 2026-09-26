import { useCallback, useState } from 'react';
import type React from 'react';
import { logger } from '../services/logger';
import { getDesktopAPI } from '../services/desktopAdapter';

interface UseLibraryFileDropOptions {
  importDisabled: boolean;
  onDropFiles?: ((files: File[]) => void) | undefined;
  onDropFilePaths?: ((filePaths: { path: string; name: string }[]) => void) | undefined;
}

interface LibraryFileDrop {
  /** An external file drag is over the list (drives the import overlay). */
  isDragging: boolean;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
}

/**
 * External audio-file drops onto the library list. Desktop builds resolve
 * real paths through the bridge; the browser build falls back to File objects.
 * Internal row reordering is handled separately by the list itself.
 */
export function useLibraryFileDrop({
  importDisabled,
  onDropFiles,
  onDropFilePaths,
}: UseLibraryFileDropOptions): LibraryFileDrop {
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

    // Get dropped files
    const droppedFiles = Array.from(e.dataTransfer.files);
    logger.debug(`[LibraryView] Total files dropped: ${droppedFiles.length}`);

    // Filter for supported audio files only (MP3, FLAC)
    const audioExtensions = ['.mp3', '.flac'];
    const audioFiles = droppedFiles.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return audioExtensions.includes(ext);
    });

    logger.debug(`[LibraryView] Audio files after filtering: ${audioFiles.length}`);

    if (audioFiles.length === 0) {
      logger.warn('[LibraryView] No audio files dropped');
      return;
    }

    // Check if we're in Electron mode and can get file paths
    const desktopAPI = getDesktopAPI();
    logger.debug('[LibraryView] Drop check - desktopAPI:', !!desktopAPI, 'getPathForFile:', !!desktopAPI?.getPathForFile, 'onDropFilePaths:', !!onDropFilePaths);

    if (desktopAPI?.getPathForFile && onDropFilePaths) {
      // Electron mode: get real file paths
      logger.debug('[LibraryView] Electron mode: getting file paths from dropped files');
      try {
        const filePaths = audioFiles.map(file => ({
          path: desktopAPI.getPathForFile!(file),
          name: file.name
        }));
        logger.debug(`[LibraryView] Got ${filePaths.length} file paths`);
        onDropFilePaths(filePaths);
        return;
      } catch (error) {
        logger.error('[LibraryView] Failed to get file paths:', error);
        // Fall through to File mode
      }
    }

    // Web mode or fallback: use File objects
    if (onDropFiles) {
      logger.debug(`[LibraryView] Web mode: passing ${audioFiles.length} File objects`);
      onDropFiles(audioFiles);
    } else {
      logger.warn('[LibraryView] No drop handler available');
    }
  }, [onDropFiles, onDropFilePaths, importDisabled]);

  return { isDragging, handleDragOver, handleDragLeave, handleDrop };
}
