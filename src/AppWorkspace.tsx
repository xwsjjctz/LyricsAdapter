import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LibrarySlot, SlotId, Track, ViewMode } from './types';
import { getDesktopAPI, getDesktopAPIAsync } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';
import { indexedDBStorage } from './services/indexedDBStorage';
import type { LibrarySettings, PlaylistsViewPersistence } from './services/libraryStorage';
import { logger } from './services/logger';
import { syncOnlineCookiesToMain } from './services/cookieManager';
import { useLibraryLoad } from './hooks/useLibraryLoad';
import { useLibraryActions } from './hooks/useLibraryActions';
import { useShortcuts } from './hooks/useShortcuts';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import BrowseView from './components/BrowseView';
import MetadataView from './components/MetadataView';
import SettingsView from './components/SettingsView';
import ThemeView from './components/ThemeView';
import Controls from './components/Controls';
import FocusMode from './components/FocusMode';
import PlaylistsView from './components/PlaylistsView';
import SearchBox from './components/SearchBox';
import { i18n } from './services/i18n';
import { useOnlineMusicIntegration } from './hooks/useOnlineMusicIntegration';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import GsapModal from './components/GsapModal';
import { useImportStore } from './stores/importStore';
import { useLibraryStore } from './stores/libraryStore';
import type { OnlineSong } from './services/onlineMusicProvider';
import { themeManager } from './services/themeManager';
import { usePlayerStore } from './stores/playerStore';
import { useUIStore } from './stores/uiStore';
import { useNewUxEnabled } from './hooks/new-ui/useNewUxEnabled';
import NewUxShell from './components/new-ui/NewUxShell';
import { usePlayerController } from './controllers/usePlayerController';
import { useLibraryController } from './controllers/useLibraryController';
import { usePlayerViewModel } from './viewmodels/usePlayerViewModel';
import { useLibraryViewModel } from './viewmodels/useLibraryViewModel';
import { useOnlineViewModel } from './viewmodels/useOnlineViewModel';
import { useImportViewModel } from './viewmodels/useImportViewModel';
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
const AppWorkspace: React.FC = () => {
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
  const newUxEnabled = useNewUxEnabled();
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
    setActiveCurrentTime,
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
  const [playlistsViewPersistence, setPlaylistsViewPersistence] = useState<PlaylistsViewPersistence>({
    phase: 'grid',
    scrollPosition: 0,
  });
  const playlistsViewPersistenceRef = useRef(playlistsViewPersistence);
  const activeSlotIdRef = useRef(activeSlotId);
  useEffect(() => {
    activeSlotIdRef.current = activeSlotId;
  }, [activeSlotId]);
  useEffect(() => {
    playlistsViewPersistenceRef.current = playlistsViewPersistence;
  }, [playlistsViewPersistence]);
  const handlePlaylistsViewPersistenceChange = useCallback((next: PlaylistsViewPersistence) => {
    playlistsViewPersistenceRef.current = next;
    setPlaylistsViewPersistence(next);
  }, []);
  const getAppPersistenceData = useCallback((): LibrarySettings => {
    const snapshot = slotsRef.current;
    const extractSlotData = (slot: LibrarySlot) => ({
      currentTrackIndex: slot.currentTrackIndex,
      currentTime: slot.currentTime,
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
      activeSlotId: activeSlotIdRef.current,
      playlistsView: playlistsViewPersistenceRef.current,
    };
  }, [slotsRef]);
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
    setActiveCurrentTime,
    updateSlot,
    onTrackSwitch: markTrackSwitch,
  });
  const player = usePlayerViewModel({
    currentTrack,
    isPlaying,
    currentTime,
    volume,
    playbackMode,
    audioRef,
    togglePlay,
    skipForward,
    skipBackward,
    handleSeek,
    handleVolumeChange,
    handleToggleMute,
    handleTogglePlaybackMode,
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
  const [pendingNewUxImportSlot, setPendingNewUxImportSlot] = useState<SlotId | null>(null);
  useEffect(() => {
    if (!pendingNewUxImportSlot || viewSlot !== pendingNewUxImportSlot) return;
    handleImportClick();
    setPendingNewUxImportSlot(null);
  }, [handleImportClick, pendingNewUxImportSlot, viewSlot]);
  const handleNewUxImportIntoSlot = useCallback(async (slotId: SlotId) => {
    if (slotId === viewSlot) {
      handleImportClick();
      return;
    }
    setPendingNewUxImportSlot(slotId);
    await handleSwitchSlot(slotId);
  }, [handleImportClick, handleSwitchSlot, viewSlot]);
  const { handleReloadFiles } = useLibraryActions({
    tracks: activeTracks,
    setTracks: setActiveTracks,
    createTrackedBlobUrl,
  });
  const { handleReloadFiles: handleReloadLocalFiles } = useLibraryActions({
    tracks: slots.local.tracks,
    setTracks: updateLocalTracks,
    createTrackedBlobUrl,
  });
  const importVm = useImportViewModel({
    fileInputRef,
    importProgress,
    importDisabled,
    importClick: handleImportClick,
    importIntoSlot: handleNewUxImportIntoSlot,
    dropFiles: handleDropFiles,
    dropFilePaths: handleViewDropFilePaths,
    onFileInputChange: handleFileInputChange,
    reloadFiles: handleReloadFiles,
    reloadUnavailable: handleReloadLocalFiles,
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
    audioRef,
    persistedTimeRef,
    updateSlot,
    onLibrarySettingsRestored: ({ activeSlotId: restoredSlotId, currentTime: restoredTime, playlistsView }) => {
      if (restoredSlotId) {
        setRestoreTime(restoredTime ?? 0);
        switchTo(restoredSlotId);
        // The playlist slot has no sidebar entry, so on restart keep the library
        // view on a real library slot (local) while the playlist resumes as the
        // active play context.
        setViewSlot(restoredSlotId === 'playlist' ? 'local' : restoredSlotId);
        // 触发 LibraryView 自动定位到当前曲目
        markTrackSwitch();
      }
      if (playlistsView) {
        playlistsViewPersistenceRef.current = playlistsView;
        setPlaylistsViewPersistence(playlistsView);
        if (playlistsView.phase === 'detail' && restoredSlotId === 'playlist') {
          transitionToView(ViewMode.PLAYLISTS);
        }
      }
    },
  });

  // Sync QQ / NetEase cookies to the main-process streaming proxy on mount.
  useEffect(() => { void syncOnlineCookiesToMain(); }, []);

  // Download-complete (add to local library) now lives in the library controller;
  // AppWorkspace delegates. (Phase 2 boundary completion — see roadmap §4.)
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
  });
  const online = useOnlineViewModel({
    progress: onlineProgress,
    playSong: playerController.playOnlineSong,
    download: handleOnlineDownload,
    upload: handleOnlineUpload,
    openPlaylist: playerController.openOnlinePlaylist,
    navigateToTrack: playerController.handleSearchNavigate,
  });

  // Whole-playlist play still delegates (PlaylistsView-only, legacy tree).
  const handlePlayPlaylist = useCallback(
    (source: 'qq' | 'netease', songs: OnlineSong[], clickedIndex: number) =>
      playerController.handlePlayPlaylist(source, songs, clickedIndex),
    [playerController],
  );

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
      src={currentTrack.audioUrl}
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={handleLoadedMetadata}
      onEnded={handleTrackEnded}
      onCanPlay={handleCanPlay}
      onError={handleAudioError}
    />
  ) : null;

  if (newUxEnabled) {
    return (
      <>
        {audioElement}
        <NewUxShell
          slots={library.slots}
          activeSlotId={library.activeSlotId}
          currentTrack={player.currentTrack}
          isPlaying={player.isPlaying}
          currentTime={player.currentTime}
          volume={player.volume}
          playbackMode={player.playbackMode}
          isFocusMode={isFocusMode}
          onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
          onOpenSlot={library.switchViewSlot}
          onTrackSelect={library.selectTrack}
          onRemoveTrack={library.removeTrack}
          onRemoveMultipleTracks={library.removeTracks}
          onUpdateTrack={library.updateTrack}
          onTogglePlay={player.togglePlay}
          onSkipNext={player.next}
          onSkipPrev={player.previous}
          onSeek={player.seek}
          onVolumeChange={player.changeVolume}
          onToggleMute={player.toggleMute}
          onTogglePlaybackMode={player.togglePlaybackMode}
          onImportIntoSlot={importVm.importIntoSlot}
          onReloadUnavailable={importVm.reloadUnavailable}
          onOpenOnlinePlaylist={online.openPlaylist}
          onClearOrphanCache={handleClearOrphanCache}
          isWindowFocused={isWindowFocused}
          onNavigateToTrack={online.navigateToTrack}
          onOnlineDownload={online.download}
          onOnlineUpload={online.upload}
          onOnlineStreamPlay={online.playSong}
          onlineProgress={online.progress}
          cloudImportDisabled={library.cloudImportDisabled}
          cloudImportDisabledReason={library.cloudImportDisabledReason}
          audioRef={player.audioRef}
          fileInputRef={importVm.fileInputRef}
          onFileInputChange={importVm.onFileInputChange}
        />
      </>
    );
  }

  return (
    <>
      {audioElement}
      <div className={`flex h-screen w-screen overflow-hidden font-sans relative${isLinux ? ' rounded-lg' : ''}`} style={floatingPanel ? {
        background: 'linear-gradient(135deg, var(--theme-background-gradient-start, #101922), var(--theme-background-gradient-end, #1a2533))',
      } : {
        backgroundColor: 'transparent',
      }}>
        <TitleBar
          isFocusMode={isFocusMode}
          onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
        />
        <div className="flex flex-1">
          <Sidebar
          onNavigate={handleNavigate}
          onReloadFiles={importVm.reloadFiles}
          hasUnavailableTracks={activeTracks.some(t => t.available === false)}
          currentView={viewMode}
          viewMode={viewMode}
          activeSlotId={viewSlot}
          onSlotChange={handleSwitchSlot}
          floating={floatingPanel}
        />
        <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden pt-8"
          style={floatingPanel ? {} : {
            background: 'linear-gradient(135deg, var(--theme-background-gradient-start, #101922), var(--theme-background-gradient-end, #1a2533))',
          }}
        >
          {/* Frosted header band — clipped to each view's measured header bottom.
              For LibraryView this ends at the song-list column divider; for
              Settings/Theme it ends at their header container bottom. */}
          {glassUI && (viewMode === ViewMode.PLAYER || viewMode === ViewMode.SETTINGS || viewMode === ViewMode.THEME) && headerHeight > 0 && (
            <div
              className="frosted-header absolute top-0 left-0 right-0 z-20"
              style={{ height: 40 + headerHeight }}
            />
          )}
          <input
            type="file"
            ref={importVm.fileInputRef}
            multiple
            accept=".flac,.mp3"
            className="hidden"
            onChange={importVm.onFileInputChange}
          />
          <div ref={pageContentRef} className={`flex-1 overflow-hidden ${floatingPanel ? 'px-10 pt-2 pb-2' : 'px-10 pt-2 pb-2'}`}>
            {viewMode === ViewMode.BROWSE ? (
              <BrowseView
                onDownloadComplete={handleDownloadComplete}
                onNavigateToSettings={() => transitionToView(ViewMode.SETTINGS)}
              />
            ) : viewMode === ViewMode.METADATA ? (
              <MetadataView
                ref={metadataViewRef}
                libraryTracks={activeTracks}
                onImportFromLibrary={(trackIds) => {
                  logger.debug('[App] Imported tracks to metadata view:', trackIds);
                }}
                onUpdateTrack={(updatedTrack) => {
                  setActiveTracks(prev => prev.map(track => 
                    track.id === updatedTrack.id ? updatedTrack : track
                  ));
                }}
              />
            ) : viewMode === ViewMode.SETTINGS ? (
              <SettingsView onClearOrphanCache={handleClearOrphanCache} onHeaderHeightChange={setHeaderHeight} />
            ) : viewMode === ViewMode.THEME ? (
              <ThemeView onHeaderHeightChange={setHeaderHeight} />
            ) : viewMode === ViewMode.PLAYLISTS ? (
              <PlaylistsView
                colors={themeManager.getCurrentTheme().colors}
                {...(currentTrack?.id != null && { currentTrackId: currentTrack.id })}
                onOpenSettings={() => transitionToView(ViewMode.SETTINGS)}
                onPlayPlaylist={(source, songs, clickedIndex) => {
                  handlePlayPlaylist(source, songs, clickedIndex);
                }}
                initialState={playlistsViewPersistence}
                onPersistenceChange={handlePlaylistsViewPersistenceChange}
              />
            ) : (
              <div ref={libraryContentRef} className="h-full">
              <LibraryView
                tracks={library.slots[library.viewSlot].tracks}
                currentTrackIndex={library.slots[library.viewSlot].currentTrackIndex}
                {...(player.currentTrack?.id != null && { currentTrackId: player.currentTrack.id })}
                onTrackSelect={library.selectTrack}
                onRemoveTrack={library.removeTrack}
                onRemoveMultipleTracks={library.removeTracks}
                onImportClick={importVm.importClick}
                importDisabled={importVm.importDisabled}
                importDisabledReason={
                  library.viewSlot === 'cloud' ? library.cloudImportDisabledReason : undefined
                }
                onOpenSettings={() => transitionToView(ViewMode.SETTINGS)}
                onDropFiles={importVm.dropFiles}
                onDropFilePaths={importVm.dropFilePaths}
                onReorderTracks={library.reorder}
                onUpdateTrack={library.updateTrack}
                isFocusMode={isFocusMode}
                savedScrollPosition={library.slots[library.viewSlot].scrollPosition}
                onScrollPositionChange={handleLibraryScrollPositionChange}
                autoLocateToken={autoLocateToken}
                importProgress={importVm.importProgress}
                dataSource={library.viewSlot}
                activeSlotId={library.activeSlotId}
                onSwitchSlot={library.switchViewSlot}
                pendingLocateSlot={pendingSlotLocate?.slot}
                pendingLocateToken={pendingSlotLocate?.token}
                onPendingLocatePrepared={handleSlotLocatePrepared}
                onSlotContentReady={handleSlotContentReady}
                filterType={slots[viewSlot].filterType}
                categorySelection={slots[viewSlot].categorySelection}
                onCategoryChange={handleCategoryChange}
                onHeaderHeightChange={setHeaderHeight}
                onLoadCloudTracks={loadCloudTracks}
                onMergeCloudTracks={mergeCloudTracks}
	                searchBox={
	                  <SearchBox
	                    isWindowFocused={isWindowFocused}
	                    localTracks={slots.local.tracks}
	                    cloudTracks={slots.cloud.tracks}
	                    onNavigateToTrack={online.navigateToTrack}
	                    onOnlineDownload={online.download}
                    onOnlineStreamPlay={online.playSong}
	                    onOnlineUpload={online.upload}
	                    onlineProgress={online.progress}
	                  />
                }
              />
              </div>
            )}
          </div>
          <Controls
            track={player.currentTrack}
            isPlaying={player.isPlaying}
            currentTime={player.currentTime}
            volume={player.volume}
            onTogglePlay={player.togglePlay}
            onSkipNext={player.next}
            onSkipPrev={player.previous}
            onSeek={player.seek}
            onVolumeChange={player.changeVolume}
            onToggleMute={player.toggleMute}
            playbackMode={player.playbackMode}
            onTogglePlaybackMode={player.togglePlaybackMode}
            onToggleFocus={() => setIsFocusMode(!isFocusMode)}
            isFocusMode={isFocusMode}
            forceUpdateCounter={0}
            audioRef={player.audioRef}
            floating={floatingPanel}
          />
        </main>
        <FocusMode
          track={player.currentTrack}
          isVisible={isFocusMode}
          currentTime={player.currentTime}
          isPlaying={player.isPlaying}
          onTogglePlay={player.togglePlay}
          onSkipNext={player.next}
          onSkipPrev={player.previous}
          onSeek={player.seek}
          volume={player.volume}
          onVolumeChange={player.changeVolume}
          onToggleMute={player.toggleMute}
          playbackMode={player.playbackMode}
          onTogglePlaybackMode={player.togglePlaybackMode}
          onToggleFocus={() => setIsFocusMode(!isFocusMode)}
          audioRef={player.audioRef}
        />
        </div>
      </div>
      <GsapModal
        isOpen={pendingNavigation !== null}
        overlayClassName="z-50"
        overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
        panelClassName="rounded-2xl p-6 w-96 shadow-2xl"
        panelStyle={{ backgroundColor: 'var(--theme-background-dark, #0d1520)', border: '1px solid var(--theme-border-light, rgba(255,255,255,0.15))' }}
      >
        {pendingNavigation && (
          <>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>
              {i18n.t('metadataView.unsavedTitle')}
            </h3>
            <p className="mb-6 text-sm" style={{ color: 'var(--theme-text-secondary, rgba(255,255,255,0.6))' }}>
              {i18n.t('metadataView.unsavedMessage')}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingNavigation(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ color: 'var(--theme-text-secondary, rgba(255,255,255,0.6))' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--theme-background-card-hover, rgba(255,255,255,0.1))'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {i18n.t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  metadataViewRef.current?.stashAll();
                  transitionToView(pendingNavigation);
                  setIsFocusMode(false);
                  setPendingNavigation(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: 'var(--theme-background-card-hover, rgba(255,255,255,0.1))', color: 'var(--theme-text-primary, #fff)' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--theme-border-light, rgba(255,255,255,0.2))'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--theme-background-card-hover, rgba(255,255,255,0.1))'; }}
              >
                {i18n.t('metadataView.stash')}
              </button>
              <button
                onClick={async () => {
                  await metadataViewRef.current?.saveAll();
                  transitionToView(pendingNavigation);
                  setIsFocusMode(false);
                  setPendingNavigation(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: 'var(--theme-primary, #2b8cee)', color: '#fff' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--theme-primary-hover, #1a7de0)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--theme-primary, #2b8cee)'; }}
              >
                {i18n.t('metadataView.saveChanges')}
              </button>
            </div>
          </>
        )}
      </GsapModal>
    </>
  );
};
export default AppWorkspace;
