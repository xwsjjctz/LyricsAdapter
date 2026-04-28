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
import MetadataView, { MetadataViewHandle } from './components/MetadataView';
import SettingsView from './components/SettingsView';
import ThemeView from './components/ThemeView';
import Controls from './components/Controls';
import FocusMode from './components/FocusMode';
import ErrorBoundary from './components/ErrorBoundary';
import { i18n } from './services/i18n';
import { QQMusicSong, qqMusicApi } from './services/qqMusicApi';
import { cookieManager } from './services/cookieManager';
import { settingsManager } from './services/settingsManager';
import { webdavClient } from './services/webdavClient';
import { generateMetaJson } from './services/webdavMetaService';
import { notify } from './services/notificationService';

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
  const metadataViewRef = useRef<MetadataViewHandle>(null);
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
    setActiveCurrentTime,
    setActiveScrollPosition,
    setActiveFilterType,
    setActiveCategorySelection,
    loadCloudTracks,
    mergeCloudTracks,
    updateLocalTracks,
    getPersistenceData,
    restoreFromPersistence,
  } = useLibrarySlots();

  const slotsRef = useRef(slots);
  slotsRef.current = slots;

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
    waitingForCanPlayRef,
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
    currentTime,
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
      }
    },
  });

  const lastScrollPositionRef = useRef<number>(0);

  const handleSwitchSlot = useCallback((targetSlot: 'local' | 'cloud') => {
    if (targetSlot === activeSlotId) return;

    setActiveScrollPosition(lastScrollPositionRef.current);

    if (audioRef.current) {
      const time = audioRef.current.currentTime || 0;
      if (time > 0) {
        setActiveCurrentTime(time);
      }
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }

    shouldAutoPlayRef.current = false;
    waitingForCanPlayRef.current = false;

    setRestoreTime(slotsRef.current[targetSlot].currentTime);
    switchTo(targetSlot);
  }, [activeSlotId, isPlaying, audioRef, setIsPlaying, switchTo, setActiveScrollPosition, setActiveCurrentTime]);

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

    if (targetSlot === activeSlotId) {
      // Same slot: simple track selection
      selectTrack(idx);
      return;
    }

    // Cross-slot: save current state, update target slot directly, then switch
    setActiveScrollPosition(lastScrollPositionRef.current);
    if (audioRef.current) {
      const time = audioRef.current.currentTime || 0;
      if (time > 0) setActiveCurrentTime(time);
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
    shouldAutoPlayRef.current = false;
    waitingForCanPlayRef.current = false;

    // Set target track index on target slot (bypass stale activeSlotId in setActiveTrackIndex)
    updateSlot(targetSlot, s => ({ ...s, currentTrackIndex: idx }));
    setRestoreTime(0);
    switchTo(targetSlot);
    // Trigger auto-play for the new track
    shouldAutoPlayRef.current = true;
    setIsPlaying(true);
  }, [activeSlotId, slots.local.tracks, slots.cloud.tracks, selectTrack, setActiveScrollPosition, audioRef, isPlaying, setIsPlaying, setActiveCurrentTime, updateSlot, switchTo]);

  const handleQQMusicDownload = useCallback(async (song: QQMusicSong, quality: '128' | '320' | 'flac') => {
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) {
      setViewMode(ViewMode.SETTINGS);
      return;
    }
    try {
      const singer = song.singer?.map(s => s.name).join(' & ') || 'Unknown';
      const ext = quality === 'flac' ? 'flac' : 'mp3';
      const fileName = `${singer} - ${song.songname}.${ext}`;
      const rawCookie = cookieManager.getCookie();
      const { url } = await qqMusicApi.getMusicUrl(song.songmid, quality);
      const fullPath = `${downloadPath}/${fileName}`;
      const result = await window.electron?.downloadAndSave?.(url, rawCookie, fullPath);
      if (!result?.success || !result.filePath) throw new Error('Download failed');
      if (window.electron?.writeAudioMetadata) {
        await window.electron.writeAudioMetadata(result.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
        });
      }
      notify(i18n.t('notifications.downloadComplete'), song.songname, { silent: true });
    } catch (err: any) {
      logger.error('[App] QQ Music download failed:', err);
      notify(i18n.t('notifications.downloadFailed'), err.message || '');
    }
  }, [setViewMode]);

  const handleQQMusicUpload = useCallback(async (song: QQMusicSong, quality: '128' | '320' | 'flac') => {
    if (!webdavClient.hasConfig()) {
      setViewMode(ViewMode.SETTINGS);
      return;
    }
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) {
      setViewMode(ViewMode.SETTINGS);
      return;
    }
    try {
      const singer = song.singer?.map(s => s.name).join(' & ') || 'Unknown';
      const ext = quality === 'flac' ? 'flac' : 'mp3';
      const fileName = `${singer} - ${song.songname}.${ext}`;
      const rawCookie = cookieManager.getCookie();
      const { url } = await qqMusicApi.getMusicUrl(song.songmid, quality);
      const fullPath = `${downloadPath}/${fileName}`;
      const dlResult = await window.electron?.downloadAndSave?.(url, rawCookie, fullPath);
      if (!dlResult?.success || !dlResult.filePath) throw new Error('Download failed');
      if (window.electron?.writeAudioMetadata) {
        await window.electron.writeAudioMetadata(dlResult.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
        });
      }
      const readResult = await window.electron?.readFile?.(dlResult.filePath);
      if (!readResult?.success || !readResult.data) throw new Error('Failed to read file for upload');
      const webdavPath = `/music/${fileName}`;
      await webdavClient.uploadFile(webdavPath, readResult.data, `audio/${ext}`);
      await webdavClient.uploadMetaJson(webdavPath, generateMetaJson({
        id: `webdav-${webdavPath}`, title: song.songname, artist: singer,
        album: song.albumname || '', duration: song.interval || 0, audioUrl: '',
        source: 'webdav', webdavPath, fileName, fileSize: readResult.data.byteLength,
      }));
      notify(i18n.t('notifications.uploadComplete'), `${song.songname} → WebDAV`, { silent: true });
    } catch (err: any) {
      logger.error('[App] QQ Music upload failed:', err);
      notify(i18n.t('notifications.uploadFailed'), err.message || '');
    }
  }, [setViewMode]);

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
          localTracks={slots.local.tracks}
          cloudTracks={slots.cloud.tracks}
          onNavigateToTrack={handleSearchNavigate}
          onQQMusicDownload={handleQQMusicDownload}
          onQQMusicUpload={handleQQMusicUpload}
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
            if (viewMode === ViewMode.METADATA && mode !== ViewMode.METADATA && metadataViewRef.current?.hasUnsavedChanges) {
              setPendingNavigation(mode);
              return;
            }
            setViewMode(mode);
            setIsFocusMode(false);
            if (viewMode !== ViewMode.BROWSE && mode === ViewMode.BROWSE) {
              isFirstLibraryLoadRef.current = false;
            }
          }}
          onReloadFiles={handleReloadFiles}
          hasUnavailableTracks={activeTracks.some(t => t.available === false)}
          currentView={viewMode}
          viewMode={viewMode}
          activeSlotId={activeSlotId}
          onSlotChange={handleSwitchSlot}
          localTrackCount={slots.local.tracks.length}
          cloudTrackCount={slots.cloud.tracks.length}
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
                tracks={activeTracks}
                currentTrackIndex={activeTrackIndex}
                {...(currentTrack?.id != null && { currentTrackId: currentTrack.id })}
                onTrackSelect={selectTrack}
                onRemoveTrack={handleRemoveTrack}
                onRemoveMultipleTracks={handleRemoveMultipleTracks}
                onDropFiles={handleDropFiles}
                onDropFilePaths={handleDropFilePaths}
                onReorderTracks={handleReorderTracks}
                isFocusMode={isFocusMode}
                savedScrollPosition={activeSlot.scrollPosition}
                onScrollPositionChange={handleLibraryScrollPositionChange}
                isFirstLoad={isFirstLibraryLoadRef.current}
                autoLocateToken={autoLocateToken}
                importProgress={importProgress}
                dataSource={activeSlotId}
                filterType={activeSlot.filterType}
                categorySelection={activeSlot.categorySelection}
                onFilterTypeChange={setActiveFilterType}
                onCategoryChange={setActiveCategorySelection}
                onLoadCloudTracks={loadCloudTracks}
                onMergeCloudTracks={mergeCloudTracks}
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
