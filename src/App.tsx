import React, { useCallback, useEffect, useRef } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { LibrarySlot, Track, ViewMode } from './types';
import { getDesktopAPI, getDesktopAPIAsync } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';
import { indexedDBStorage } from './services/indexedDBStorage';
import type { LibrarySettings } from './services/libraryStorage';
import { logger } from './services/logger';
import { syncOnlineCookiesToMain } from './services/cookieManager';
import { useLibraryLoad } from './hooks/useLibraryLoad';
import { useLibraryActions } from './hooks/useLibraryActions';
import { useShortcuts } from './hooks/useShortcuts';
import AppShell from './components/AppShell';
import { useOnlineMusicIntegration } from './hooks/useOnlineMusicIntegration';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useAppClosePreparation } from './hooks/useAppClosePreparation';
import { useImportStore } from './stores/importStore';
import { useLibraryStore } from './stores/libraryStore';
import type { OnlineSource } from './services/onlineMusicProvider';
import { usePlayerStore } from './stores/playerStore';
import { useUIStore } from './stores/uiStore';
import { useSidebarLayout } from './hooks/useSidebarLayout';
import { usePlayerController } from './controllers/usePlayerController';
import { useLibraryController } from './controllers/useLibraryController';
import { usePlayerViewModel } from './viewmodels/usePlayerViewModel';
import { useLibraryViewModel } from './viewmodels/useLibraryViewModel';
import { useOnlineViewModel } from './viewmodels/useOnlineViewModel';
import { useImportViewModel } from './viewmodels/useImportViewModel';
import { useMediaSession } from './hooks/useMediaSession';

declare global {
  interface Window {
    __DEV__?: boolean;
  }
  interface ImportMeta {
    env?: {
      DEV?: boolean;
      MODE?: string;
      PROD?: boolean;
    };
  }
}

const AppContent: React.FC = () => {
  const {
    viewMode,
    setViewMode,
    transitionToView,
    pageContentRef,
    isFocusMode,
    setIsFocusMode,
    autoLocateToken,
    markTrackSwitch,
    pendingNavigation,
    setPendingNavigation,
    headerHeight,
    setHeaderHeight,
    metadataViewRef,
    isWindowFocused,
    floatingPanel,
    glassUI,
    handleNavigate,
  } = useUIStore();
  const sidebar = useSidebarLayout();
  const {
    slots,
    slotsRef,
    activeSlotId,
    activeTracks,
    activeTrackIndex,
    switchTo,
    updateSlot,
    setActiveTrackIndex,
    setActiveTracks,
    loadCloudTracks,
    mergeCloudTracks,
    updateLocalTracks,
    addOnlineTrack,
    updateOnlineTracks,
    loadOnlineTracks,
    loadPlaylistTracks,
    updatePlaylistTracks,
    restoreFromPersistence,
    viewSlot,
    setViewSlot,
    libraryContentRef,
    pendingSlotLocate,
    cloudWritable,
    handleSwitchSlot,
    handleSlotContentReady,
    handleSlotLocatePrepared,
    handleLibraryScrollPositionChange,
    handleCategoryChange,
  } = useLibraryStore();
  const activeSlotIdRef = useRef(activeSlotId);
  activeSlotIdRef.current = activeSlotId;
  const {
    audioRef,
    setAudioRef,
    currentTrack,
    isPlaying,
    setIsPlaying,
    currentTime,
    volume,
    setVolume,
    playbackMode,
    setPlaybackMode,
    togglePlay,
    skipForward,
    skipBackward,
    handleSeek,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleTrackEnded,
    handleCanPlay,
    handleVolumeChange,
    handleToggleMute,
    handleTogglePlaybackMode,
    handleAudioError,
    selectTrack,
    persistedTimeRef,
    getCurrentPlaybackTime,
    shouldAutoPlayRef,
    setRestoreTime,
    activeBlobUrlsRef,
    createTrackedBlobUrl,
    revokeBlobUrl,
  } = usePlayerStore({
    activeTracks,
    activeTrackIndex,
    activeSlotId,
    setActiveTracks,
    setActiveTrackIndex,
    updateSlot,
    onTrackSwitch: markTrackSwitch,
  });
  const getAppPersistenceData = useCallback((): LibrarySettings => {
    const snapshot = slotsRef.current;
    const activeId = activeSlotIdRef.current;
    const activePlaybackTime = getCurrentPlaybackTime();
    const extractSlotData = (slot: LibrarySlot) => ({
      currentTrackIndex: slot.currentTrackIndex,
      // Inactive slots are committed explicitly when playback crosses slot
      // boundaries. Only the active slot reads the ref-backed live clock.
      currentTime: slot.id === activeId ? activePlaybackTime : slot.currentTime,
      volume: slot.volume,
      playbackMode: slot.playbackMode,
      scrollPosition: slot.scrollPosition,
      filterType: slot.filterType,
      categorySelection: slot.categorySelection,
    });

    return {
      localSlot: extractSlotData(snapshot.local),
      cloudSlot: extractSlotData(snapshot.cloud),
      onlineSlot: extractSlotData(snapshot.online),
      playlistSlot: extractSlotData(snapshot.playlist),
      activeSlotId: activeId,
    };
  }, [getCurrentPlaybackTime, slotsRef]);
  const player = usePlayerViewModel({
    currentTrack,
    isPlaying,
    currentTime,
    volume,
    playbackMode,
    getCurrentPlaybackTime,
    togglePlay,
    skipForward,
    skipBackward,
    handleSeek,
    handleVolumeChange,
    handleToggleMute,
    handleTogglePlaybackMode,
  });
  useMediaSession({
    currentTrack: player.currentTrack,
    isPlaying: player.isPlaying,
    currentTime: player.currentTime,
    duration: player.duration,
    getCurrentPlaybackTime: player.getCurrentPlaybackTime,
    togglePlay: player.togglePlay,
    next: player.next,
    previous: player.previous,
    seek: player.seek,
  });
  const playerController = usePlayerController({
    activeSlotId,
    viewSlot,
    localTracks: slots.local.tracks,
    cloudTracks: slots.cloud.tracks,
    setViewSlot,
    updateSlot,
    switchTo,
    addOnlineTrack,
    updateOnlineTracks,
    onlineTracks: slots.online.tracks,
    onlineCurrentIndex: slots.online.currentTrackIndex,
    loadPlaylistTracks,
    updatePlaylistTracks,
    playlistTracks: slots.playlist.tracks,
    playlistCurrentIndex: slots.playlist.currentTrackIndex,
    audioRef,
    shouldAutoPlayRef,
    selectTrack,
    setIsPlaying,
    setRestoreTime,
    markTrackSwitch,
  });
  const {
    fileInputRef,
    handleDropFiles,
    handleFileInputChange,
    importProgress,
    handleImportClick,
    handleViewDropFilePaths,
    importDisabled,
  } = useImportStore({
    localTracks: slots.local.tracks,
    updateLocalTracks,
    activeTrackIndex,
    isPlaying,
    currentTrack,
    volume,
    playbackMode,
    createTrackedBlobUrl,
    persistedTimeRef,
    getPersistenceData: getAppPersistenceData,
    mergeCloudTracks,
    viewSlot,
    cloudWritable,
  });
  const { handleReloadFiles } = useLibraryActions({
    tracks: activeTracks,
    setTracks: setActiveTracks,
    createTrackedBlobUrl,
  });
  const importVm = useImportViewModel({
    fileInputRef,
    importProgress,
    importDisabled,
    importClick: handleImportClick,
    dropFiles: handleDropFiles,
    dropFilePaths: handleViewDropFilePaths,
    onFileInputChange: handleFileInputChange,
    reloadFiles: handleReloadFiles,
  });
  const libraryController = useLibraryController({
    viewSlot,
    activeSlotId,
    slots,
    slotsRef,
    updateSlot,
    updateLocalTracks,
    getAppPersistenceData,
    audioRef,
    setIsPlaying,
    revokeBlobUrl,
  });
  const library = useLibraryViewModel({
    slots,
    activeSlotId,
    viewSlot,
    cloudWritable,
    switchViewSlot: handleSwitchSlot,
    selectTrack: playerController.handleTrackSelect,
    removeTrack: libraryController.removeTrack,
    removeTracks: libraryController.removeTracks,
    reorder: libraryController.reorderTracks,
    updateTrack: libraryController.updateTrack,
  });
  // Library mutations (remove / batch-remove / reorder / updateTrack /
  // selectTrack / switchViewSlot) are now consumed via the library ViewModel;
  // the per-handler delegates that lived here were removed by the Phase 4
  // LibraryViewModel wiring.

  useLibraryLoad({
    restoreFromPersistence,
    getPersistenceData: getAppPersistenceData,
    getSlotsSnapshot: () => slotsRef.current,
    slots,
    setLocalTracks: updateLocalTracks,
    loadCloudTracks,
    loadOnlineTracks,
    loadPlaylistTracks,
    setIsPlaying,
    setVolume,
    setPlaybackMode,
    currentPlaybackTime: currentTime,
    updateSlot,
    onLibrarySettingsRestored: ({ activeSlotId: restoredSlotId, currentTime: restoredTime }) => {
      if (restoredSlotId) {
        setRestoreTime(restoredTime ?? 0);
        switchTo(restoredSlotId);
        // The playlist slot is a play context rather than a persisted browse
        // destination, so keep the restored library view on a real source.
        setViewSlot(restoredSlotId === 'playlist' ? 'local' : restoredSlotId);
        // 触发 LibraryView 自动定位到当前曲目
        markTrackSwitch();
      }
    },
  });

  // Sync QQ / NetEase cookies to the main-process streaming proxy on mount.
  useEffect(() => { void syncOnlineCookiesToMain(); }, []);

  // Download-complete (add to local library) now lives in the library controller;
  // AppContent delegates. (Phase 2 boundary completion — see roadmap §4.)
  const handleDownloadComplete = useCallback(
    (track: Track) => libraryController.addDownloadedTrack(track),
    [libraryController],
  );
  // Reorder and track-selection are now consumed via the library/player
  // ViewModels; the per-handler delegates that lived here were removed by the
  // Phase 4 wiring.
  const { onlineProgress, handleOnlineDownload, handleOnlineUpload } = useOnlineMusicIntegration({
    setViewMode,
    mergeCloudTracks,
    onDownloadComplete: handleDownloadComplete,
  });
  const online = useOnlineViewModel({
    progress: onlineProgress,
    playSong: playerController.playOnlineSong,
    download: handleOnlineDownload,
    upload: handleOnlineUpload,
    navigateToTrack: playerController.handleSearchNavigate,
  });

  const handleOpenPlaylist = useCallback(async (
    source: OnlineSource,
    playlistId: string,
    playlistTitle: string,
    totalTrackCount: number,
  ) => {
    await playerController.openOnlinePlaylistInLibrary(source, playlistId, playlistTitle, totalTrackCount);
    await handleSwitchSlot('playlist');
    transitionToView(ViewMode.PLAYER);
  }, [handleSwitchSlot, playerController, transitionToView]);

  // The playlist lyrics sliding-window effect (current ± 1 prefetch + eviction)
  // now runs inside the player controller, keyed on playlistCurrentIndex.
  useShortcuts({
    viewMode,
    isFocusMode,
    isPlaying,
    setIsFocusMode,
    setViewMode,
    togglePlay,
    skipForward,
    skipBackward,
    handleSeek,
    volume,
    setVolume,
    handleToggleMute,
    handleTogglePlaybackMode,
    currentTime,
    duration: currentTrack?.duration || 0
  });
  useAppLifecycle({ activeBlobUrlsRef });
  useAppClosePreparation();

  // 清理孤儿缓存：删除已不在库中的曲目残留的元数据、封面等缓存
  const handleClearOrphanCache = useCallback(async (): Promise<{ metadataDeleted: number; coversDeleted: number; errors: string[] }> => {
    const errors: string[] = [];
    const allTrackIds = new Set<string>();
    const allWebdavPaths = new Set<string>();

    // 收集所有活跃的 track ID 和 WebDAV 路径
    for (const track of slots.local.tracks) {
      allTrackIds.add(track.id);
    }
    for (const track of slots.cloud.tracks) {
      allTrackIds.add(track.id);
      if (track.webdavPath) {
        allWebdavPaths.add(track.webdavPath);
      }
    }

    let metadataDeleted = 0;
    let coversDeleted = 0;

    // 1. 清理 IndexedDB 中孤儿元数据条目
    try {
      metadataDeleted = await indexedDBStorage.deleteOrphanMetadata(allTrackIds);
    } catch (error) {
      errors.push(`Failed to cleanup metadata: ${(error as Error).message}`);
      logger.error('[App] Orphan metadata cleanup error:', error);
    }

    // 2. 清理 IndexedDB 中孤儿 WebDAV 元数据
    try {
      const webdavDeleted = await indexedDBStorage.deleteOrphanWebdavMetadata(allWebdavPaths);
      metadataDeleted += webdavDeleted;
    } catch (error) {
      errors.push(`Failed to cleanup WebDAV metadata: ${(error as Error).message}`);
      logger.error('[App] Orphan WebDAV metadata cleanup error:', error);
    }

    // 3. 清理 WebDAV 文件列表快照（可重新生成）
    try {
      await indexedDBStorage.clearFileListSnapshot();
    } catch (error) {
      errors.push(`Failed to clear WebDAV snapshot: ${(error as Error).message}`);
    }

    // 4. 清理封面文件
    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI?.cleanupOrphanCovers) {
      try {
        const coverResult = await desktopAPI.cleanupOrphanCovers(Array.from(allTrackIds));
        if (coverResult.success) {
          coversDeleted = coverResult.removed || 0;
        } else {
          errors.push(coverResult.error || 'Cover cleanup failed');
        }
      } catch (error) {
        errors.push(`Cover cleanup error: ${(error as Error).message}`);
      }
    }

    // 5. 清除内存缓存
    metadataCacheService.clear();

    logger.info(`[App] Cache cleanup complete: ${metadataDeleted} metadata entries, ${coversDeleted} covers deleted`);
    if (errors.length > 0) {
      logger.warn('[App] Cache cleanup errors:', errors.join(', '));
    }

    return { metadataDeleted, coversDeleted, errors };
  }, [slots]);

  const desktopAPISync = getDesktopAPI();
  const platform = desktopAPISync?.platform || '';
  const isLinux = platform === 'linux';
  const audioElement = currentTrack ? (
    <audio
      ref={setAudioRef}
      preload="metadata"
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={handleLoadedMetadata}
      onEnded={handleTrackEnded}
      onCanPlay={handleCanPlay}
      onError={handleAudioError}
    />
  ) : null;

  return (
    <AppShell
      ui={{
        viewMode, setViewMode, transitionToView, pageContentRef,
        isFocusMode, setIsFocusMode, autoLocateToken, markTrackSwitch,
        pendingNavigation, setPendingNavigation, headerHeight, setHeaderHeight,
        metadataViewRef, isWindowFocused, floatingPanel, glassUI, handleNavigate,
      }}
      sidebar={sidebar}
      library={library}
      player={player}
      importVm={importVm}
      online={online}
      playerController={playerController}
      slots={slots}
      activeTracks={activeTracks}
      viewSlot={viewSlot}
      handleSwitchSlot={handleSwitchSlot}
      pendingSlotLocate={pendingSlotLocate}
      loadCloudTracks={loadCloudTracks}
      mergeCloudTracks={mergeCloudTracks}
      handleLibraryScrollPositionChange={handleLibraryScrollPositionChange}
      handleSlotContentReady={handleSlotContentReady}
      handleSlotLocatePrepared={handleSlotLocatePrepared}
      handleCategoryChange={handleCategoryChange}
      libraryContentRef={libraryContentRef}
      setActiveTracks={setActiveTracks}
      onClearOrphanCache={handleClearOrphanCache}
      onOpenPlaylist={handleOpenPlaylist}
      audioElement={audioElement}
      isLinux={isLinux}
      libraryBrowsingTracks={playerController.libraryBrowsingTracks}
      onPlayLibraryPlaylistTrack={playerController.playLibraryPlaylistTrack}
    />
  );
};

const App: React.FC = () => (
  <ErrorBoundary>
    <AppContent />
  </ErrorBoundary>
);

export default App;
