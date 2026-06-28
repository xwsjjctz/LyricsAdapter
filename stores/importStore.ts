import { useCallback } from 'react';
import type { Track } from '../types';
import { useImport } from '../hooks/useImport';
import { isDesktop } from '../services/desktopAdapter';
import type { LibrarySlotId } from './libraryStore';

interface ImportStoreOptions {
  localTracks: Track[];
  updateLocalTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  activeTrackIndex: number;
  isPlaying: boolean;
  currentTrack: Track | null;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  createTrackedBlobUrl: (blob: Blob | File) => string;
  persistedTimeRef: React.MutableRefObject<number>;
  getPersistenceData: () => { localSlot: any; cloudSlot: any; activeSlotId: LibrarySlotId };
  mergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
  viewSlot: LibrarySlotId;
  cloudWritable: boolean | null;
}

export function useImportStore(options: ImportStoreOptions) {
  const importApi = useImport({
    tracks: options.localTracks,
    setTracks: options.updateLocalTracks,
    currentTrackIndex: options.activeTrackIndex,
    isPlaying: options.isPlaying,
    currentTrack: options.currentTrack,
    volume: options.volume,
    playbackMode: options.playbackMode,
    createTrackedBlobUrl: options.createTrackedBlobUrl,
    persistedTimeRef: options.persistedTimeRef,
    getPersistenceData: options.getPersistenceData,
    mergeCloudTracks: options.mergeCloudTracks,
  });

  const handleImportClick = useCallback(() => {
    if (options.viewSlot === 'cloud') {
      importApi.handleCloudImport();
    } else if (isDesktop()) {
      importApi.handleDesktopImport();
    } else {
      importApi.fileInputRef.current?.click();
    }
  }, [importApi.handleCloudImport, importApi.handleDesktopImport, importApi.fileInputRef, options.viewSlot]);

  const handleViewDropFilePaths = useCallback((filePaths: { path: string; name: string }[]) => {
    if (options.viewSlot === 'cloud') {
      importApi.handleCloudDropFilePaths(filePaths);
      return;
    }
    importApi.handleDropFilePaths(filePaths);
  }, [importApi.handleCloudDropFilePaths, importApi.handleDropFilePaths, options.viewSlot]);

  return {
    ...importApi,
    handleImportClick,
    handleViewDropFilePaths,
    importDisabled: options.viewSlot === 'cloud' && options.cloudWritable !== true,
  };
}
