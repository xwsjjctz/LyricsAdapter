import React, { useCallback, useEffect, useRef } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { LibrarySlot, Track, ViewMode } from './types';
import { getDesktopAPI } from './services/desktopAdapter';
import type { LibrarySettings } from './services/libraryStorage';
import { syncOnlineCookiesToMain } from './services/cookieManager';
import { qqCredentialManager } from './services/qqCredentialManager';
import { useLibraryLoad } from './hooks/useLibraryLoad';
import { useLibraryActions } from './hooks/useLibraryActions';
import { useShortcuts } from './hooks/useShortcuts';
import { commandPalette } from './hooks/useCommandPalette';
import AppShell from './components/AppShell';
import { useOnlineMusicIntegration } from './hooks/useOnlineMusicIntegration';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useAppClosePreparation } from './hooks/useAppClosePreparation';
import { useImportStore } from './stores/importStore';
import { useLibraryStore } from './stores/libraryStore';
import type { OnlineSource } from './services/onlineMusicProvider';
import { usePlayerStore } from './stores/playerStore';
import { useUIStore } from './stores/uiStore';
import { usePlayerController } from './controllers/usePlayerController';
import { useLibraryController } from './controllers/useLibraryController';
import { usePlayerViewModel } from './viewmodels/usePlayerViewModel';
import { useLibraryViewModel } from './viewmodels/useLibraryViewModel';
import { useOnlineViewModel } from './viewmodels/useOnlineViewModel';
import { useImportViewModel } from './viewmodels/useImportViewModel';
import { useMediaSession } from './hooks/useMediaSession';
import { useSystemLyrics } from './hooks/useSystemLyrics';

declare global {
  interface Window {
    __DEV__?: boolean;
  }
}

const openPaletteMusicSearch = () => commandPalette.open('library');

const AppContent: React.FC = () => {
  const ui = useUIStore();
  const {
    viewMode,
    transitionToView,
    isFocusMode,
    setIsFocusMode,
    markTrackSwitch,
    openSettings,
  } = ui;
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
    handleSlotLocatePrepared,
    handleSlotContentReady,
    handleLibraryScrollPositionChange,
    handleCategoryChange,
    getLiveScrollPosition,
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
    pausePlayback,
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
    // The viewed slot's scroll position lives in a ref until scrolling pauses,
    // so read it live here instead of persisting a value up to one debounce
    // window old.
    const liveScroll = getLiveScrollPosition();
    const extractSlotData = (slot: LibrarySlot) => ({
      currentTrackIndex: slot.currentTrackIndex,
      // Inactive slots are committed explicitly when playback crosses slot
      // boundaries. Only the active slot reads the ref-backed live clock.
      currentTime: slot.id === activeId ? activePlaybackTime : slot.currentTime,
      volume: slot.volume,
      playbackMode: slot.playbackMode,
      scrollPosition: slot.id === liveScroll.slot ? liveScroll.position : slot.scrollPosition,
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
  }, [getCurrentPlaybackTime, getLiveScrollPosition, slotsRef]);
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
    setPlaybackMode,
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
  useSystemLyrics({
    currentTrack: player.currentTrack,
    currentTime: player.currentTime,
    isPlaying: player.isPlaying,
    getCurrentPlaybackTime: player.getCurrentPlaybackTime,
    togglePlay: player.togglePlay,
    next: player.next,
    previous: player.previous,
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
    pausePlayback,
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
    swap: libraryController.swapTracks,
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
        // No locate here: the library reopens at its saved scroll offset.
      }
    },
  });

  // Sync QQ / NetEase cookies to the main-process streaming proxy on mount.
  useEffect(() => { void syncOnlineCookiesToMain(); }, []);

  // Renew the QQ Music musickey before it expires (no-op without a stored credential).
  useEffect(() => {
    qqCredentialManager.start();
    return () => qqCredentialManager.stop();
  }, []);

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
    openSettings,
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
    // Show the playlist (and its loading state) right away instead of waiting
    // for the first page; openOnlinePlaylistInLibrary resets its state synchronously.
    const loading = playerController.openOnlinePlaylistInLibrary(source, playlistId, playlistTitle, totalTrackCount);
    loading.catch(() => undefined); // still rethrown by `await loading` below
    await handleSwitchSlot('playlist');
    // Playlists always open on the poster wall.
    if (viewMode !== ViewMode.WALL) transitionToView(ViewMode.WALL);
    await loading;
  }, [handleSwitchSlot, playerController, transitionToView, viewMode]);

  // The playlist lyrics sliding-window effect (current ± 1 prefetch + eviction)
  // now runs inside the player controller, keyed on playlistCurrentIndex.
  useShortcuts({
    isFocusMode,
    isPlaying,
    setIsFocusMode,
    openSettings,
    togglePlay,
    skipForward,
    skipBackward,
    handleSeek,
    volume,
    setVolume,
    handleToggleMute,
    handleTogglePlaybackMode,
    toggleCommandPalette: commandPalette.toggle,
    openMusicSearch: openPaletteMusicSearch,
    currentTime,
    duration: currentTrack?.duration || 0
  });
  useAppLifecycle({ activeBlobUrlsRef });
  useAppClosePreparation();

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
      ui={ui}
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
      handleSlotLocatePrepared={handleSlotLocatePrepared}
      handleSlotContentReady={handleSlotContentReady}
      handleLibraryScrollPositionChange={handleLibraryScrollPositionChange}
      handleCategoryChange={handleCategoryChange}
      libraryContentRef={libraryContentRef}
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
