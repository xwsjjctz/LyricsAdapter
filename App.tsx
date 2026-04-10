import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Track, ViewMode } from './types';
import { getDesktopAPIAsync, getDesktopAPI, isDesktop, type DesktopAPI } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';
import { libraryStorage } from './services/libraryStorage';
import { buildLibraryIndexData } from './services/librarySerializer';
import { logger } from './services/logger';
import { useBlobUrls } from './hooks/useBlobUrls';
import { usePlayback } from './hooks/usePlayback';
import { useLibraryLoad } from './hooks/useLibraryLoad';
import { useImport } from './hooks/useImport';
import { useLibraryActions } from './hooks/useLibraryActions';
import { useShortcuts } from './hooks/useShortcuts';
import { themeManager } from './services/themeManager';

// Components
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

// Declare global Window interface for browser APIs
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
  const [tracks, setTracks] = useState<Track[]>([]);
  const [localTracksBackup, setLocalTracksBackup] = useState<Track[] | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [forceUpdateCounter] = useState(0); // Force re-render after restore
  const [searchInputValue, setSearchInputValue] = useState(''); // Global search input value (shared between views)
  const [searchTrigger, setSearchTrigger] = useState(0); // Trigger to execute search
  const [libraryScrollPosition, setLibraryScrollPosition] = useState<Record<'local' | 'cloud', number>>({ local: 0, cloud: 0 });
  const [cloudTracks, setCloudTracks] = useState<Track[]>([]);
  const [autoLocateToken, setAutoLocateToken] = useState(0);
  const isFirstLibraryLoadRef = useRef(true);
  const [libraryDataSource, setLibraryDataSource] = useState<'local' | 'cloud'>('local');
  const [libraryFilterType, setLibraryFilterType] = useState<'default' | 'album' | 'artist'>('default');
  const [libraryCategorySelection, setLibraryCategorySelection] = useState<string | null>(null);
  const [webdavTracks, setWebdavTracks] = useState<Track[]>([]);
  const pendingCloudRestoreRef = useRef<string | null>(null);
  const pendingLocalTrackIdRef = useRef<string | null>(null);

  const { activeBlobUrlsRef, createTrackedBlobUrl, revokeBlobUrl } = useBlobUrls();
  const handleTrackSwitch = useCallback(() => {
    setAutoLocateToken(prev => prev + 1);
  }, []);

  const playback = usePlayback({
    tracks,
    setTracks,
    currentTrackIndex,
    setCurrentTrackIndex,
    webdavTracks: cloudTracks,
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
    setCloudTrack,
    clearCloudTrack,
    shouldAutoPlayRef,
    restoredTimeRef,
    restoredTrackIdRef,
    persistedTimeRef,
    cloudTrackIndex
  } = playback;

  const {
    fileInputRef,
    handleDesktopImport,
    handleDropFiles,
    handleDropFilePaths,
    handleFileInputChange,
    importProgress
  } = useImport({
    tracks,
    setTracks,
    currentTrackIndex,
    isPlaying,
    currentTrack,
    volume,
    playbackMode,
    currentTime,
    createTrackedBlobUrl,
    persistedTimeRef
  });

  const { handleRemoveTrack, handleRemoveMultipleTracks, handleReloadFiles } = useLibraryActions({
    tracks,
    setTracks,
    currentTrackIndex,
    setCurrentTrackIndex,
    isPlaying,
    setIsPlaying,
    createTrackedBlobUrl,
    revokeBlobUrl,
    audioRef,
    shouldAutoPlayRef
  });

  useLibraryLoad({
    tracks,
    setTracks,
    currentTrackIndex,
    currentTrack,
    isPlaying,
    volume,
    playbackMode,
    currentTime,
    setCurrentTrackIndex,
    setIsPlaying,
    setVolume,
    setPlaybackMode,
    audioRef,
    restoredTimeRef,
    restoredTrackIdRef,
    shouldAutoPlayRef,
    persistedTimeRef,
    libraryDataSource,
    cloudTracks,
    cloudTrackIndex,
    onLibrarySettingsRestored: ({ libraryDataSource: restoredDataSource, localCurrentTrackId, cloudCurrentTrackId }) => {
      if (restoredDataSource === 'cloud') {
        setLibraryDataSource('cloud');
        if (cloudCurrentTrackId) {
          pendingCloudRestoreRef.current = cloudCurrentTrackId;
        }
      }
    }
  });

  // Handle download completion from BrowseView
  const handleDownloadComplete = useCallback(async (track: Track) => {
    logger.debug('[App] Download complete, adding track to library:', track.title);

    // Check if track already exists (by filePath)
    const existingTrack = tracks.find(t => t.filePath === track.filePath);
    if (existingTrack) {
      logger.debug('[App] Track already exists in library, skipping:', track.title);
      return;
    }

    // Add track to library
    const newTracks = [...tracks, track];
    setTracks(newTracks);
    logger.debug('[App] Track added to library:', track.title);

    // Save metadata cache
    await metadataCacheService.save();

    // Save library to disk
    const libraryData = buildLibraryIndexData(newTracks, {
      volume: volume,
      currentTrackIndex: currentTrackIndex,
      currentTrackId: currentTrack?.id,
      currentTime: persistedTimeRef.current || currentTime,
      isPlaying: isPlaying,
      playbackMode: playbackMode,
      libraryDataSource,
      localCurrentTrackId: libraryDataSource === 'local' ? currentTrack?.id : undefined,
      cloudCurrentTrackId: libraryDataSource === 'cloud' ? cloudTracks[cloudTrackIndex]?.id : undefined
    });
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after download');
  }, [tracks, setTracks, volume, currentTrackIndex, currentTrack, currentTime, isPlaying, playbackMode, persistedTimeRef]);

  // Handle track reordering
  const handleReorderTracks = useCallback(async (fromIndex: number, toIndex: number) => {
    logger.debug(`[App] Reordering track from ${fromIndex} to ${toIndex}`);

    // Create new array with reordered tracks
    const newTracks = [...tracks];
    const [movedTrack] = newTracks.splice(fromIndex, 1);

    // Adjust toIndex when moving down because array shifted after removal
    const adjustedToIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
    newTracks.splice(adjustedToIndex, 0, movedTrack);

    // Update current track index if needed
    let newCurrentTrackIndex = currentTrackIndex;
    if (currentTrackIndex === fromIndex) {
      newCurrentTrackIndex = adjustedToIndex;
    } else if (currentTrackIndex > fromIndex && currentTrackIndex < toIndex) {
      newCurrentTrackIndex = currentTrackIndex - 1;
    } else if (currentTrackIndex < fromIndex && currentTrackIndex > toIndex) {
      newCurrentTrackIndex = currentTrackIndex + 1;
    }

    setTracks(newTracks);
    setCurrentTrackIndex(newCurrentTrackIndex);

    // Save library to disk
    const libraryData = buildLibraryIndexData(newTracks, {
      volume: volume,
      currentTrackIndex: newCurrentTrackIndex,
      currentTrackId: newTracks[newCurrentTrackIndex]?.id,
      currentTime: persistedTimeRef.current || currentTime,
      isPlaying: isPlaying,
      playbackMode: playbackMode,
      libraryDataSource,
      localCurrentTrackId: libraryDataSource === 'local' ? newTracks[newCurrentTrackIndex]?.id : undefined,
      cloudCurrentTrackId: libraryDataSource === 'cloud' ? cloudTracks[cloudTrackIndex]?.id : undefined
    });
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after reordering');
  }, [tracks, setTracks, currentTrackIndex, setCurrentTrackIndex, volume, currentTrack, currentTime, isPlaying, playbackMode, persistedTimeRef, libraryDataSource, cloudTracks, cloudTrackIndex]);

  // Handle library scroll position change
  const handleLibraryScrollPositionChange = useCallback((position: number) => {
    setLibraryScrollPosition(prev => ({ ...prev, [libraryDataSource]: position }));
  }, [libraryDataSource]);

  // Initialize keyboard shortcuts
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

  // Initialize theme on mount
  useEffect(() => {
    const theme = themeManager.getCurrentTheme();
    const root = document.documentElement;
    const colors = theme.colors;
    const fonts = theme.fonts;
    const radius = theme.borderRadius;

    // Apply CSS custom properties (CSS variables)
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

    // Apply font family to body
    root.style.fontFamily = fonts.main;

    // Add/remove dark mode class
    if (theme.isDark) {
      root.classList.add('theme-dark');
      root.classList.remove('theme-light');
    } else {
      root.classList.add('theme-light');
      root.classList.remove('theme-dark');
    }

    logger.debug('[App] Theme initialized:', themeManager.getCurrentThemeId());
  }, []);

  // Detect platform for FocusMode exit button display
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
            // When leaving Library view, mark first load as done
            if (viewMode !== ViewMode.BROWSE && mode === ViewMode.BROWSE) {
              isFirstLibraryLoadRef.current = false;
            }
          }}
          onReloadFiles={handleReloadFiles}
          hasUnavailableTracks={tracks.some(t => t.available === false)}
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
                libraryTracks={tracks}
                onImportFromLibrary={(trackIds) => {
                  logger.debug('[App] Imported tracks to metadata view:', trackIds);
                }}
                onUpdateTrack={(updatedTrack) => {
                  setTracks(prev => prev.map(track => 
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
                tracks={tracks}
                currentTrackIndex={currentTrackIndex}
                currentTrackId={currentTrack?.id}
                onTrackSelect={selectTrack}
                onCloudTrackSelect={setCloudTrack}
                onRemoveTrack={handleRemoveTrack}
                onRemoveMultipleTracks={handleRemoveMultipleTracks}
                onDropFiles={handleDropFiles}
                onDropFilePaths={handleDropFilePaths}
                onReorderTracks={handleReorderTracks}
                isFocusMode={isFocusMode}
                inputValue={searchInputValue}
                searchTrigger={searchTrigger}
                savedScrollPosition={libraryScrollPosition[libraryDataSource]}
                onScrollPositionChange={handleLibraryScrollPositionChange}
                isFirstLoad={isFirstLibraryLoadRef.current}
                autoLocateToken={autoLocateToken}
                onNavigateToSettings={() => setViewMode(ViewMode.SETTINGS)}
                importProgress={importProgress}
                dataSource={libraryDataSource}
                filterType={libraryFilterType}
                categorySelection={libraryCategorySelection}
                onDataSourceChange={setLibraryDataSource}
                onFilterTypeChange={setLibraryFilterType}
                onCategoryChange={setLibraryCategorySelection}
                webdavTracks={webdavTracks}
                onWebdavTracksChange={setWebdavTracks}
                onCloudLoad={async (webdavTracks) => {
                  const localTrackId = currentTrack?.id;
                  pendingLocalTrackIdRef.current = localTrackId;
                  const cloudTrackId = cloudTracks[cloudTrackIndex]?.id;
                  setCloudTracks(webdavTracks);
                  if (pendingCloudRestoreRef.current) {
                    const restoreId = pendingCloudRestoreRef.current;
                    pendingCloudRestoreRef.current = null;
                    const restoreIndex = webdavTracks.findIndex(t => t.id === restoreId);
                    if (restoreIndex >= 0) {
                      setCloudTrack(restoreIndex);
                    }
                  }
                  if (!localTracksBackup) {
                    setLocalTracksBackup(tracks);
                  }
                  const libraryData = buildLibraryIndexData(tracks, {
                    volume: volume,
                    currentTrackIndex: currentTrackIndex,
                    currentTrackId: currentTrack?.id,
                    currentTime: persistedTimeRef.current || currentTime,
                    isPlaying: isPlaying,
                    playbackMode: playbackMode,
                    libraryDataSource: 'cloud',
                    localCurrentTrackId: localTrackId,
                    cloudCurrentTrackId: cloudTrackId
                  });
                  libraryStorage.clearSaveTimer();
                  const api = await getDesktopAPIAsync();
                  if (api) {
                    await api.saveLocalLibraryBackup(libraryData);
                    await api.saveLibraryIndex(libraryData);
                    logger.info('[App] Local library saved to backup and main file before switching to cloud');
                  }
                }}
                onLocalRestore={async () => {
                  const api = await getDesktopAPIAsync();
                  if (api) {
                    const result = await api.loadLocalLibraryBackup();
                    if (result.success && result.library) {
                      const backupData = result.library as { songs: any[]; settings: any };
                      const restoredTracks: Track[] = (backupData.songs || []).map((song: any) => ({
                        id: song.id,
                        title: song.title || song.fileName?.replace(/\.[^/.]+$/, '') || 'Unknown',
                        artist: song.artist || 'Unknown Artist',
                        album: song.album || 'Unknown Album',
                        duration: song.duration || 0,
                        lyrics: song.lyrics || '',
                        syncedLyrics: song.syncedLyrics,
                        coverUrl: song.coverUrl,
                        audioUrl: '',
                        filePath: song.filePath,
                        fileName: song.fileName,
                        fileSize: song.fileSize,
                        lastModified: song.lastModified,
                        addedAt: song.addedAt,
                        playCount: song.playCount || 0,
                        lastPlayed: song.lastPlayed || undefined,
                        available: song.available ?? true
                      }));
                      const localTrackId = pendingLocalTrackIdRef.current || backupData.settings?.localCurrentTrackId;
                      pendingLocalTrackIdRef.current = null;
                      await api.saveLibraryIndex(backupData);
                      setTracks(restoredTracks);
                      logger.info('[App] Local library restored from backup');
                      setLocalTracksBackup(null);
                      clearCloudTrack();
                      if (localTrackId) {
                        const restoredIndex = restoredTracks.findIndex(t => t.id === localTrackId);
                        if (restoredIndex >= 0) {
                          setCurrentTrackIndex(restoredIndex);
                        }
                      }
                      return;
                    }
                  }
                  if (localTracksBackup) {
                    const localTrackId = pendingLocalTrackIdRef.current;
                    pendingLocalTrackIdRef.current = null;
                    setTracks(localTracksBackup);
                    setLocalTracksBackup(null);
                    clearCloudTrack();
                    if (localTrackId) {
                      const restoredIndex = localTracksBackup.findIndex(t => t.id === localTrackId);
                      if (restoredIndex >= 0) {
                        setCurrentTrackIndex(restoredIndex);
                      }
                    }
                  }
                }}
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
            forceUpdateCounter={forceUpdateCounter}
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
