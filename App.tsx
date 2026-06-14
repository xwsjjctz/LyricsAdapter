import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Track, ViewMode } from './types';
import { getDesktopAPI, isDesktop } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';
import { libraryStorage } from './services/libraryStorage';
import { buildLibraryIndexData } from './services/librarySerializer';
import { logger } from './services/logger';
import { useBlobUrls } from './hooks/useBlobUrls';
import { usePlayback } from './hooks/usePlayback';
import { useLibrarySlots } from './hooks/useLibrarySlots';
import { useLibraryLoad } from './hooks/useLibraryLoad';
import { useImport } from './hooks/useImport';
import { useLibraryActions } from './hooks/useLibraryActions';
import { useShortcuts } from './hooks/useShortcuts';
import { useWindowFocus } from './hooks/useWindowFocus';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import BrowseView from './components/BrowseView';
import MetadataView, { MetadataViewHandle } from './components/MetadataView';
import SettingsView from './components/SettingsView';
import ThemeView from './components/ThemeView';
import Controls from './components/Controls';
import FocusMode from './components/FocusMode';
import SearchBox from './components/SearchBox';
import ErrorBoundary from './components/ErrorBoundary';
import { i18n } from './services/i18n';
import { useQQMusicIntegration } from './hooks/useQQMusicIntegration';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useFloatingPanel } from './hooks/useFloatingPanel';
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
const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [autoLocateToken, setAutoLocateToken] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState<ViewMode | null>(null);
  const isWindowFocused = useWindowFocus();
  const floatingPanel = useFloatingPanel();
  const metadataViewRef = useRef<MetadataViewHandle>(null);
  // QQ Music download/upload progress
  const {
    slots,
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
    getPersistenceData,
    restoreFromPersistence,
  } = useLibrarySlots();
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const [viewSlot, setViewSlot] = useState<'local' | 'cloud'>('local');
  const [restoreTime, setRestoreTime] = useState(0);
  const { activeBlobUrlsRef, createTrackedBlobUrl, revokeBlobUrl } = useBlobUrls();
  const handleTrackSwitch = useCallback(() => {
    setAutoLocateToken(prev => prev + 1);
  }, []);
  const playback = usePlayback({
    tracks: activeTracks,
    setTracks: setActiveTracks,
    currentTrackIndex: activeTrackIndex,
    setCurrentTrackIndex: setActiveTrackIndex,
    createTrackedBlobUrl,
    revokeBlobUrl,
    onTrackSwitch: handleTrackSwitch,
    initialCurrentTime: restoreTime,
  });
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
  } = playback;
  const prevSlotIdRef = useRef(activeSlotId);
  useEffect(() => {
    if (activeSlotId !== prevSlotIdRef.current) {
      prevSlotIdRef.current = activeSlotId;
      return;
    }
    if (currentTime > 0) {
      setActiveCurrentTime(currentTime);
    }
  }, [currentTime, setActiveCurrentTime, activeSlotId]);
  useEffect(() => {
    updateSlot(activeSlotId, s => s.volume !== volume ? { ...s, volume } : s);
  }, [volume, activeSlotId]);
  useEffect(() => {
    updateSlot(activeSlotId, s => s.playbackMode !== playbackMode ? { ...s, playbackMode } : s);
  }, [playbackMode, activeSlotId]);
  useEffect(() => {
    if (restoreTime > 0) {
      setRestoreTime(0);
    }
  }, [activeTrackIndex, restoreTime]);
  const {
    fileInputRef,
    handleDesktopImport,
    handleDropFiles,
    handleDropFilePaths,
    handleFileInputChange,
    importProgress
  } = useImport({
    tracks: slots.local.tracks,
    setTracks: updateLocalTracks,
    currentTrackIndex: activeTrackIndex,
    isPlaying,
    currentTrack,
    volume,
    playbackMode,
    createTrackedBlobUrl,
    persistedTimeRef,
    getPersistenceData,
  });
  const { handleRemoveTrack, handleRemoveMultipleTracks, handleReloadFiles } = useLibraryActions({
    tracks: activeTracks,
    setTracks: setActiveTracks,
    currentTrackIndex: activeTrackIndex,
    setCurrentTrackIndex: setActiveTrackIndex,
    isPlaying,
    setIsPlaying,
    createTrackedBlobUrl,
    revokeBlobUrl,
    audioRef,
  });
  useLibraryLoad({
    restoreFromPersistence,
    getPersistenceData,
    slots,
    setLocalTracks: updateLocalTracks,
    loadCloudTracks,
    setIsPlaying,
    setVolume,
    setPlaybackMode,
    audioRef,
    persistedTimeRef,
    updateSlot,
    onLibrarySettingsRestored: ({ activeSlotId: restoredSlotId, currentTime: restoredTime }) => {
      if (restoredSlotId) {
        setRestoreTime(restoredTime ?? 0);
        switchTo(restoredSlotId);
        setViewSlot(restoredSlotId);
        // 触发 LibraryView 自动定位到当前曲目
        handleTrackSwitch();
      }
    },
  });
  const lastScrollPositionRef = useRef<number>(0);
  const handleSwitchSlot = useCallback((targetSlot: 'local' | 'cloud') => {
    if (targetSlot === viewSlot) return;
    // Save current view's scroll position before switching
    updateSlot(viewSlot, s => ({ ...s, scrollPosition: lastScrollPositionRef.current }));
    // Switch view only — playback continues uninterrupted
    setViewSlot(targetSlot);
  }, [viewSlot, updateSlot]);
  const handleLibraryScrollPositionChange = useCallback((position: number) => {
    lastScrollPositionRef.current = position;
    updateSlot(viewSlot, s => ({ ...s, scrollPosition: position }));
  }, [viewSlot, updateSlot]);
  const handleImportClick = useCallback(() => {
    if (isDesktop()) {
      handleDesktopImport();
    } else {
      fileInputRef.current?.click();
    }
  }, [handleDesktopImport]);
  const handleNavigate = useCallback((mode: ViewMode) => {
    if (viewMode === ViewMode.METADATA && mode !== ViewMode.METADATA && metadataViewRef.current?.hasUnsavedChanges) {
      setPendingNavigation(mode);
      return;
    }
    setViewMode(mode);
    setIsFocusMode(false);
  }, [viewMode, setViewMode, setIsFocusMode]);
  const handleDownloadComplete = useCallback(async (track: Track) => {
    logger.debug('[App] Download complete, adding track to library:', track.title);
    const existingTrack = slots.local.tracks.find(t => t.filePath === track.filePath);
    if (existingTrack) {
      logger.debug('[App] Track already exists in library, skipping:', track.title);
      return;
    }
    const newTracks = [...slots.local.tracks, track];
    updateLocalTracks(newTracks);
    logger.debug('[App] Track added to library:', track.title);
    await metadataCacheService.save();
    const persistData = getPersistenceData();
    const libraryData = buildLibraryIndexData(newTracks, persistData);
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after download');
  }, [slots.local.tracks, updateLocalTracks, getPersistenceData]);
  const handleReorderTracks = useCallback(async (fromIndex: number, toIndex: number) => {
    logger.debug(`[App] Reordering track from ${fromIndex} to ${toIndex}`);
    const newTracks = [...activeTracks];
    const [movedTrack] = newTracks.splice(fromIndex, 1);
    if (!movedTrack) return;
    const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
    newTracks.splice(adjustedToIndex, 0, movedTrack);
    let newCurrentTrackIndex = activeTrackIndex;
    if (activeTrackIndex === fromIndex) {
      newCurrentTrackIndex = adjustedToIndex;
    } else if (activeTrackIndex > fromIndex && activeTrackIndex < toIndex) {
      newCurrentTrackIndex = activeTrackIndex - 1;
    } else if (activeTrackIndex < fromIndex && activeTrackIndex > toIndex) {
      newCurrentTrackIndex = activeTrackIndex + 1;
    }
    setActiveTracks(newTracks);
    setActiveTrackIndex(newCurrentTrackIndex);
    const persistData = getPersistenceData();
    const libraryData = buildLibraryIndexData(
      activeSlotId === 'local' ? newTracks : slots.local.tracks,
      persistData
    );
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after reordering');
  }, [activeTracks, activeTrackIndex, setActiveTracks, setActiveTrackIndex, activeSlotId, slots.local.tracks, getPersistenceData]);
  // Global search handlers
  const handleSearchNavigate = useCallback((track: Track) => {
    const targetSlot: 'local' | 'cloud' = track.source === 'webdav' ? 'cloud' : 'local';
    const targetTracks = targetSlot === 'local' ? slots.local.tracks : slots.cloud.tracks;
    const idx = targetTracks.findIndex(t => t.id === track.id);
    if (idx < 0) return;
    if (targetSlot === activeSlotId && targetSlot === viewSlot) {
      // Same slot, same view: simple track selection
      selectTrack(idx);
      return;
    }
    // Cross-slot or cross-view: save playing slot's time, update target, switch
    if (targetSlot !== activeSlotId) {
      updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
      updateSlot(targetSlot, s => ({ ...s, currentTrackIndex: idx }));
      setRestoreTime(0);
      switchTo(targetSlot);
      shouldAutoPlayRef.current = true;
      setIsPlaying(true);
    } else {
      // Same slot, different view: just select track (view will sync below)
      selectTrack(idx);
    }
    // Sync view to match the playing slot
    setViewSlot(targetSlot);
  }, [activeSlotId, viewSlot, slots.local.tracks, slots.cloud.tracks, selectTrack, audioRef, updateSlot, switchTo, setIsPlaying]);
  // Track selection handler that handles cross-slot selection
  // When viewing a different slot than what's playing, clicking a track
  // switches the active slot to the view slot without pausing audio.
  const handleTrackSelect = useCallback((trackIndex: number) => {
    if (viewSlot !== activeSlotId) {
      // Cross-slot: save playing slot's time, switch active slot, then play
      updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
      updateSlot(viewSlot, s => ({ ...s, currentTrackIndex: trackIndex }));
      setRestoreTime(0);
      handleTrackSwitch();
      switchTo(viewSlot);
      shouldAutoPlayRef.current = true;
      setIsPlaying(true);
    } else {
      selectTrack(trackIndex);
    }
  }, [viewSlot, activeSlotId, selectTrack, updateSlot, switchTo, setIsPlaying, audioRef, handleTrackSwitch]);
  // Filter/category change handlers — save to viewSlot instead of activeSlotId
  const handleFilterTypeChange = useCallback((filterType: 'default' | 'album' | 'artist') => {
    updateSlot(viewSlot, s => ({ ...s, filterType }));
  }, [viewSlot, updateSlot]);
  const handleCategoryChange = useCallback((selection: string | null) => {
    updateSlot(viewSlot, s => ({ ...s, categorySelection: selection }));
  }, [viewSlot, updateSlot]);
  const { qqProgress, handleQQMusicDownload, handleQQMusicUpload } = useQQMusicIntegration({
    setViewMode,
    mergeCloudTracks,
  });
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
    onImportClick: () => {
      if (isDesktop()) {
        handleDesktopImport();
      } else {
        fileInputRef.current?.click();
      }
    },
    currentTime,
    duration: currentTrack?.duration || 0
  });
  useAppLifecycle({ activeBlobUrlsRef });
  const desktopAPISync = getDesktopAPI();
  const platform = desktopAPISync?.platform || '';
  const isLinux = platform === 'linux';
  return (
    <ErrorBoundary>
      <div className={`flex h-screen w-screen overflow-hidden font-sans relative${isLinux ? ' rounded-lg' : ''}`} style={floatingPanel ? {
        background: 'linear-gradient(135deg, var(--theme-background-gradient-start, #101922), var(--theme-background-gradient-end, #1a2533))',
      } : {
        backgroundColor: 'var(--theme-background-dark, #101922)',
      }}>
        <TitleBar
          isFocusMode={isFocusMode}
          onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
        />
        <div className="flex flex-1">
          <Sidebar
          onImportClick={handleImportClick}
          onNavigate={handleNavigate}
          onReloadFiles={handleReloadFiles}
          hasUnavailableTracks={activeTracks.some(t => t.available === false)}
          currentView={viewMode}
          viewMode={viewMode}
          activeSlotId={viewSlot}
          onSlotChange={handleSwitchSlot}
          localTrackCount={slots.local.tracks.length}
          cloudTrackCount={slots.cloud.tracks.length}
          floating={floatingPanel}
        />
        <main className="flex-1 flex flex-col relative overflow-hidden pt-8"
          style={floatingPanel ? {} : {
            background: 'linear-gradient(135deg, var(--theme-background-gradient-start, #101922), var(--theme-background-gradient-end, #1a2533))',
          }}
        >
          {currentTrack && (
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
          )}
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept=".flac,.mp3,.m4a,.wav"
            className="hidden"
            onChange={handleFileInputChange}
          />
          <div className={`flex-1 overflow-hidden ${floatingPanel ? 'px-10 pt-2 pb-2' : 'px-10 pt-2 pb-2'}`}>
            {viewMode === ViewMode.BROWSE ? (
              <BrowseView
                onDownloadComplete={handleDownloadComplete}
                onNavigateToSettings={() => setViewMode(ViewMode.SETTINGS)}
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
              <SettingsView />
            ) : viewMode === ViewMode.THEME ? (
              <ThemeView />
            ) : (
              <LibraryView
                tracks={slots[viewSlot].tracks}
                currentTrackIndex={slots[viewSlot].currentTrackIndex}
                {...(currentTrack?.id != null && { currentTrackId: currentTrack.id })}
                onTrackSelect={handleTrackSelect}
                onRemoveTrack={handleRemoveTrack}
                onRemoveMultipleTracks={handleRemoveMultipleTracks}
                onDropFiles={handleDropFiles}
                onDropFilePaths={handleDropFilePaths}
                onReorderTracks={handleReorderTracks}
                onUpdateTrack={(track) => updateSlot(viewSlot, s => ({ ...s, tracks: s.tracks.map(t => t.id === track.id ? track : t) }))}
                isFocusMode={isFocusMode}
                savedScrollPosition={slots[viewSlot].scrollPosition}
                onScrollPositionChange={handleLibraryScrollPositionChange}
                autoLocateToken={autoLocateToken}
                importProgress={importProgress}
                dataSource={viewSlot}
                activeSlotId={activeSlotId}
                onSwitchSlot={handleSwitchSlot}
                filterType={slots[viewSlot].filterType}
                categorySelection={slots[viewSlot].categorySelection}
                onFilterTypeChange={handleFilterTypeChange}
                onCategoryChange={handleCategoryChange}
                onLoadCloudTracks={loadCloudTracks}
                onMergeCloudTracks={mergeCloudTracks}
	                searchBox={
	                  <SearchBox
	                    isWindowFocused={isWindowFocused}
	                    localTracks={slots.local.tracks}
	                    cloudTracks={slots.cloud.tracks}
	                    onNavigateToTrack={handleSearchNavigate}
	                    onQQMusicDownload={handleQQMusicDownload}
	                    onQQMusicUpload={handleQQMusicUpload}
	                    qqProgress={qqProgress}
	                  />
	                }
              />
            )}
          </div>
          <Controls
            track={currentTrack}
            isPlaying={isPlaying}
            currentTime={currentTime}
            volume={volume}
            onTogglePlay={togglePlay}
            onSkipNext={skipForward}
            onSkipPrev={skipBackward}
            onSeek={handleSeek}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
            playbackMode={playbackMode}
            onTogglePlaybackMode={handleTogglePlaybackMode}
            onToggleFocus={() => setIsFocusMode(!isFocusMode)}
            isFocusMode={isFocusMode}
            forceUpdateCounter={0}
            audioRef={audioRef}
            floating={floatingPanel}
          />
        </main>
        <FocusMode
          track={currentTrack}
          isVisible={isFocusMode}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          onSkipNext={skipForward}
          onSkipPrev={skipBackward}
          onSeek={handleSeek}
          volume={volume}
          onVolumeChange={handleVolumeChange}
          onToggleMute={handleToggleMute}
          playbackMode={playbackMode}
          onTogglePlaybackMode={handleTogglePlaybackMode}
          onToggleFocus={() => setIsFocusMode(!isFocusMode)}
          audioRef={audioRef}
        />
        </div>
      </div>
      {pendingNavigation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}>
          <div className="rounded-2xl p-6 w-96 shadow-2xl" style={{ backgroundColor: 'var(--theme-background-dark, #0d1520)', border: '1px solid var(--theme-border-light, rgba(255,255,255,0.15))' }}>
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
                  setViewMode(pendingNavigation);
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
                  setViewMode(pendingNavigation);
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
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
};
export default App;
