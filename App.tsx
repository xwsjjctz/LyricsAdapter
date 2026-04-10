import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Track, ViewMode } from './types';
import { getDesktopAPIAsync, getDesktopAPI, isDesktop } from './services/desktopAdapter';
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
import { themeManager } from './services/themeManager';

import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import BrowseView from './components/BrowseView';
import MetadataView from './components/MetadataView';
import SettingsView from './components/SettingsView';
import ThemeView from './components/ThemeView';
import Controls from './components/Controls';
import FocusMode from './components/FocusMode';
import ErrorBoundary from './components/ErrorBoundary';

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
  const [searchInputValue, setSearchInputValue] = useState('');
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [autoLocateToken, setAutoLocateToken] = useState(0);
  const isFirstLibraryLoadRef = useRef(true);

  const {
    slots,
    activeSlotId,
    activeSlot,
    activeTracks,
    activeTrackIndex,
    switchTo,
    updateSlot,
    setActiveTrackIndex,
    setActiveTracks,
    setActiveScrollPosition,
    setActiveFilterType,
    setActiveCategorySelection,
    loadCloudTracks,
    updateLocalTracks,
    getPersistenceData,
    restoreFromPersistence,
  } = useLibrarySlots();

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
    onTrackSwitch: handleTrackSwitch
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
  } = playback;

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
    currentTime,
    createTrackedBlobUrl,
    persistedTimeRef
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
    setActiveTrackIndex,
    setIsPlaying,
    setVolume: (v: number) => updateSlot('local', s => ({ ...s, volume: v })),
    setPlaybackMode: (m: 'order' | 'shuffle' | 'repeat-one') => updateSlot('local', s => ({ ...s, playbackMode: m })),
    audioRef,
    persistedTimeRef,
    onLibrarySettingsRestored: ({ activeSlotId: restoredSlotId }) => {
      if (restoredSlotId) {
        switchTo(restoredSlotId);
      }
    },
  });

  const lastScrollPositionRef = useRef<number>(0);

  const handleSwitchSlot = useCallback((targetSlot: 'local' | 'cloud') => {
    if (targetSlot === activeSlotId) return;

    setActiveScrollPosition(lastScrollPositionRef.current);

    if (audioRef.current && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    switchTo(targetSlot);
  }, [activeSlotId, isPlaying, audioRef, setIsPlaying, switchTo, setActiveScrollPosition]);

  const handleLibraryScrollPositionChange = useCallback((position: number) => {
    lastScrollPositionRef.current = position;
    setActiveScrollPosition(position);
  }, [setActiveScrollPosition]);

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

  useEffect(() => {
    const initDesktopAPI = async () => {
      logger.debug('[App] Initializing Desktop API...');
      try {
        const api = await getDesktopAPIAsync();
        if (api) {
          logger.debug('[App] ✓ Desktop API initialized, platform:', api.platform);
        } else {
          logger.debug('[App] No Desktop API available (running in browser)');
        }
      } catch (error) {
        logger.error('[App] Failed to initialize Desktop API:', error);
      }
    };

    initDesktopAPI();

    return () => {
      logger.debug('[App] Cleaning up', activeBlobUrlsRef.current.size, 'blob URLs...');
      activeBlobUrlsRef.current.forEach(blobUrl => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // Ignore errors during cleanup
        }
      });
      activeBlobUrlsRef.current.clear();
      logger.debug('[App] ✓ All blob URLs revoked');

      metadataCacheService.revokeAllBlobUrls();
    };
  }, [activeBlobUrlsRef]);

  useEffect(() => {
    const theme = themeManager.getCurrentTheme();
    const root = document.documentElement;
    const colors = theme.colors;
    const fonts = theme.fonts;
    const radius = theme.borderRadius;

    root.style.setProperty('--theme-primary', colors.primary);
    root.style.setProperty('--theme-primary-hover', colors.primaryHover);
    root.style.setProperty('--theme-primary-light', colors.primaryLight);
    root.style.setProperty('--theme-background-dark', colors.backgroundDark);
    root.style.setProperty('--theme-background-gradient-start', colors.backgroundGradientStart);
    root.style.setProperty('--theme-background-gradient-end', colors.backgroundGradientEnd);
    root.style.setProperty('--theme-background-sidebar', colors.backgroundSidebar);
    root.style.setProperty('--theme-background-card', colors.backgroundCard);
    root.style.setProperty('--theme-background-card-hover', colors.backgroundCardHover);
    root.style.setProperty('--theme-text-primary', colors.textPrimary);
    root.style.setProperty('--theme-text-secondary', colors.textSecondary);
    root.style.setProperty('--theme-text-muted', colors.textMuted);
    root.style.setProperty('--theme-border-light', colors.borderLight);
    root.style.setProperty('--theme-border-hover', colors.borderHover);
    root.style.setProperty('--theme-accent', colors.accent);
    root.style.setProperty('--theme-accent-hover', colors.accentHover);
    root.style.setProperty('--theme-success', colors.success);
    root.style.setProperty('--theme-warning', colors.warning);
    root.style.setProperty('--theme-error', colors.error);
    root.style.setProperty('--theme-info', colors.info);
    root.style.setProperty('--theme-shadow-color', colors.shadowColor);
    root.style.setProperty('--theme-glow-color', colors.glowColor);
    root.style.setProperty('--theme-font-main', fonts.main);
    root.style.setProperty('--theme-radius-sm', radius.sm);
    root.style.setProperty('--theme-radius-md', radius.md);
    root.style.setProperty('--theme-radius-lg', radius.lg);
    root.style.setProperty('--theme-radius-xl', radius.xl);
    root.style.setProperty('--theme-radius-full', radius.full);

    root.style.fontFamily = fonts.main;

    if (theme.isDark) {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
    } else {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
    }

    logger.debug('[App] Theme initialized:', themeManager.getCurrentThemeId());
  }, []);

  const desktopAPISync = getDesktopAPI();
  const platform = desktopAPISync?.platform || '';
  const isLinux = platform === 'linux';

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden font-sans relative" style={{
        backgroundColor: 'var(--theme-background-dark, #101922)',
      }}>
        <TitleBar
          isFocusMode={isFocusMode}
          onToggleFocusMode={() => setIsFocusMode(!isFocusMode)}
        />
        <div className="flex flex-1">
          <Sidebar
          onImportClick={() => {
            if (isDesktop()) {
              handleDesktopImport();
            } else {
              fileInputRef.current?.click();
            }
          }}
          onNavigate={(mode) => { 
            setViewMode(mode); 
            setIsFocusMode(false); 
            if (viewMode !== ViewMode.BROWSE && mode === ViewMode.BROWSE) {
              isFirstLibraryLoadRef.current = false;
            }
          }}
          onReloadFiles={handleReloadFiles}
          hasUnavailableTracks={activeTracks.some(t => t.available === false)}
          currentView={viewMode}
          searchInputValue={searchInputValue}
          onSearchInputChange={setSearchInputValue}
          onSearchExecute={() => setSearchTrigger(prev => prev + 1)}
          viewMode={viewMode}
        />

        <main className="flex-1 flex flex-col relative overflow-hidden pt-8" style={{
          background: 'linear-gradient(135deg, var(--theme-background-gradient-start, #101922), var(--theme-background-gradient-end, #1a2533))',
        }}>
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

          <div className="flex-1 p-10 overflow-hidden pt-6">
            {viewMode === ViewMode.BROWSE ? (
              <BrowseView
                inputValue={searchInputValue}
                searchTrigger={searchTrigger}
                onDownloadComplete={handleDownloadComplete}
                onNavigateToSettings={() => setViewMode(ViewMode.SETTINGS)}
              />
            ) : viewMode === ViewMode.METADATA ? (
              <MetadataView
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
                tracks={activeTracks}
                currentTrackIndex={activeTrackIndex}
                currentTrackId={currentTrack?.id}
                onTrackSelect={selectTrack}
                onRemoveTrack={handleRemoveTrack}
                onRemoveMultipleTracks={handleRemoveMultipleTracks}
                onDropFiles={handleDropFiles}
                onDropFilePaths={handleDropFilePaths}
                onReorderTracks={handleReorderTracks}
                isFocusMode={isFocusMode}
                inputValue={searchInputValue}
                searchTrigger={searchTrigger}
                savedScrollPosition={activeSlot.scrollPosition}
                onScrollPositionChange={handleLibraryScrollPositionChange}
                isFirstLoad={isFirstLibraryLoadRef.current}
                autoLocateToken={autoLocateToken}
                onNavigateToSettings={() => setViewMode(ViewMode.SETTINGS)}
                importProgress={importProgress}
                dataSource={activeSlotId}
                filterType={activeSlot.filterType}
                categorySelection={activeSlot.categorySelection}
                onDataSourceChange={handleSwitchSlot}
                onFilterTypeChange={setActiveFilterType}
                onCategoryChange={setActiveCategorySelection}
                onLoadCloudTracks={loadCloudTracks}
                cloudTracks={slots.cloud.tracks}
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
          />
        </main>

        <FocusMode
          track={currentTrack}
          isVisible={isFocusMode}
          currentTime={currentTime}
          onClose={() => setIsFocusMode(false)}
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
          showExitButton={isLinux}
        />
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;
