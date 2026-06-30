import React, { useCallback } from 'react';
import { Track, ViewMode } from './types';
import { getDesktopAPI, getDesktopAPIAsync } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';
import { indexedDBStorage } from './services/indexedDBStorage';
import { libraryStorage } from './services/libraryStorage';
import { buildLibraryIndexDataForSlots } from './services/librarySerializer';
import { logger } from './services/logger';
import { coverArtService } from './services/coverArtService';
import { reorderTracks } from './services/libraryReorder';
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
import SearchBox from './components/SearchBox';
import { i18n } from './services/i18n';
import { useOnlineMusicIntegration } from './hooks/useOnlineMusicIntegration';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import GsapModal from './components/GsapModal';
import { useImportStore } from './stores/importStore';
import { useLibraryStore } from './stores/libraryStore';
import { usePlayerStore } from './stores/playerStore';
import { useUIStore } from './stores/uiStore';
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
    getPersistenceData,
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
    handleFilterTypeChange,
    handleCategoryChange,
  } = useLibraryStore();
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
    getPersistenceData,
    mergeCloudTracks,
    viewSlot,
    cloudWritable,
  });
  const { handleReloadFiles } = useLibraryActions({
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
  // View-slot-aware track removal — operates on slots[viewSlot] instead of slots[activeSlotId].
  // This ensures deletion works correctly when browsing a different slot than the one playing.
  const handleRemoveTrackFromView = useCallback(async (trackId: string, deleteFile = false) => {
    const slotTracks = slotsRef.current[viewSlot].tracks;
    const trackToRemove = slotTracks.find(t => t.id === trackId);

    // Delete physical audio file if requested
    if (deleteFile && trackToRemove?.filePath) {
      const desktopAPI = await getDesktopAPIAsync();
      if (desktopAPI?.deleteAudioFile) {
        try {
          const result = await desktopAPI.deleteAudioFile(trackToRemove.filePath);
          if (result.success && result.deleted) {
            logger.debug(`[App] ✓ Deleted audio file: ${trackToRemove.filePath}`);
          } else if (!result.success) {
            logger.warn(`[App] Failed to delete audio file: ${trackToRemove.filePath}`, result.error);
          }
        } catch (error) {
          logger.warn('[App] deleteAudioFile error:', error);
        }
      }
    }

    // Update the view slot's tracks and currentTrackIndex atomically
    updateSlot(viewSlot, (slot) => {
      const newTracks = slot.tracks.filter(t => t.id !== trackId);
      const removedIndex = slot.tracks.findIndex(t => t.id === trackId);
      const removedTrack = slot.tracks[removedIndex];
      let newIndex = slot.currentTrackIndex;

      if (newTracks.length === 0) {
        newIndex = -1;
        if (viewSlot === activeSlotId) {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
          }
          setIsPlaying(false);
        }
      } else if (removedIndex >= 0) {
        if (removedIndex < slot.currentTrackIndex) {
          newIndex = Math.max(0, slot.currentTrackIndex - 1);
        } else if (removedIndex === slot.currentTrackIndex) {
          newIndex = Math.min(slot.currentTrackIndex, newTracks.length - 1);
        }
      }

      if (removedTrack) {
        if (removedTrack.audioUrl?.startsWith('blob:')) revokeBlobUrl(removedTrack.audioUrl);
        if (removedTrack.coverUrl?.startsWith('blob:')) revokeBlobUrl(removedTrack.coverUrl);
      }

      return { ...slot, tracks: newTracks, currentTrackIndex: newIndex };
    });

    // Clean up cover and metadata (trackId-based, independent of slot)
    try {
      await coverArtService.deleteCover(trackId);
      await indexedDBStorage.deleteMetadata(trackId);
      logger.debug(`[App] ✅ Resources cleaned up for track: ${trackToRemove?.title || trackId}`);
    } catch (error) {
      logger.warn('[App] Failed to cleanup resources for track:', error);
    }
  }, [viewSlot, activeSlotId, updateSlot, audioRef, revokeBlobUrl, setIsPlaying]);

  const handleRemoveMultipleTracksFromView = useCallback(async (trackIds: string[], deleteFile = false) => {
    const slotTracks = slotsRef.current[viewSlot].tracks;
    const tracksToRemove = slotTracks.filter(t => trackIds.includes(t.id));

    const desktopAPI = await getDesktopAPIAsync();

    // Delete physical audio files
    if (deleteFile && desktopAPI?.deleteAudioFile) {
      for (const track of tracksToRemove) {
        if (!track.filePath) continue;
        try {
          const result = await desktopAPI.deleteAudioFile(track.filePath);
          if (result.success && result.deleted) {
            logger.debug(`[App] ✓ Deleted audio file: ${track.filePath}`);
          } else if (!result.success) {
            logger.warn(`[App] Failed to delete audio file: ${track.filePath}`, result.error);
          }
        } catch (error) {
          logger.warn('[App] deleteAudioFile error:', error);
        }
      }
    }

    // Revoke blob URLs and clean up cover thumbnails & metadata
    for (const track of tracksToRemove) {
      if (track.audioUrl?.startsWith('blob:')) revokeBlobUrl(track.audioUrl);
      if (track.coverUrl?.startsWith('blob:')) revokeBlobUrl(track.coverUrl);
    }

    if (desktopAPI?.deleteCoverThumbnail) {
      for (const track of tracksToRemove) {
        try {
          await desktopAPI.deleteCoverThumbnail(track.id);
        } catch (error) {
          logger.warn(`[App] Failed to delete cover thumbnail for ${track.title}:`, error);
        }
      }
    }

    for (const trackId of trackIds) {
      try {
        await indexedDBStorage.deleteMetadata(trackId);
      } catch (error) {
        logger.warn(`[App] Failed to delete metadata for ${trackId}:`, error);
      }
    }

    // Update the view slot's tracks and currentTrackIndex atomically
    updateSlot(viewSlot, (slot) => {
      const newTracks = slot.tracks.filter(t => !trackIds.includes(t.id));

      let newIndex = slot.currentTrackIndex;
      if (newTracks.length === 0) {
        newIndex = -1;
        if (viewSlot === activeSlotId) {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
          }
          setIsPlaying(false);
        }
      } else {
        const removedBeforeCurrent = trackIds.filter(id => {
          const idx = slot.tracks.findIndex(t => t.id === id);
          return idx >= 0 && idx < slot.currentTrackIndex;
        }).length;
        newIndex = slot.currentTrackIndex - removedBeforeCurrent;
        if (newIndex >= newTracks.length) newIndex = Math.max(0, newTracks.length - 1);
        if (newIndex < 0) newIndex = 0;
      }

      return { ...slot, tracks: newTracks, currentTrackIndex: newIndex };
    });

    logger.debug(`[App] ✓ Batch removal complete: ${trackIds.length} tracks removed from ${viewSlot}`);
  }, [viewSlot, activeSlotId, updateSlot, audioRef, revokeBlobUrl, setIsPlaying]);

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
        markTrackSwitch();
      }
    },
  });
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
    const libraryData = buildLibraryIndexDataForSlots(newTracks, slots.cloud.tracks, persistData);
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after download');
  }, [slots.local.tracks, slots.cloud.tracks, updateLocalTracks, getPersistenceData]);
  const handleReorderTracks = useCallback(async (fromIndex: number, toIndex: number) => {
    logger.debug(`[App] Reordering ${viewSlot} track from ${fromIndex} to ${toIndex}`);
    const sourceSlot = slots[viewSlot];
    const result = reorderTracks(sourceSlot.tracks, sourceSlot.currentTrackIndex, fromIndex, toIndex);
    if (!result.changed) return;

    updateSlot(viewSlot, slot => ({
      ...slot,
      tracks: result.tracks,
      currentTrackIndex: result.currentTrackIndex,
    }));

    const persistData = getPersistenceData();
    const libraryData = buildLibraryIndexDataForSlots(
      activeSlotId === 'local' ? result.tracks : slots.local.tracks,
      activeSlotId === 'cloud' ? result.tracks : slots.cloud.tracks,
      persistData
    );
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after reordering');
  }, [activeSlotId, getPersistenceData, slots, updateSlot, viewSlot]);
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
      markTrackSwitch();
      switchTo(viewSlot);
      shouldAutoPlayRef.current = true;
      setIsPlaying(true);
    } else {
      selectTrack(trackIndex);
    }
  }, [viewSlot, activeSlotId, selectTrack, updateSlot, switchTo, setIsPlaying, audioRef, markTrackSwitch]);
  const { onlineProgress, handleOnlineDownload, handleOnlineUpload } = useOnlineMusicIntegration({
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
    onImportClick: handleImportClick,
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
  return (
    <>
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
          importDisabled={importDisabled}
          importDisabledReason={
            viewSlot === 'cloud'
              ? (cloudWritable === null
                  ? i18n.t('sidebar.importChecking')
                  : i18n.t('sidebar.importReadOnly'))
              : undefined
          }
          floating={floatingPanel}
        />
        <main className="flex-1 flex flex-col relative overflow-hidden pt-8"
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
            accept=".flac,.mp3"
            className="hidden"
            onChange={handleFileInputChange}
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
            ) : (
              <div ref={libraryContentRef} className="h-full">
              <LibraryView
                tracks={slots[viewSlot].tracks}
                currentTrackIndex={slots[viewSlot].currentTrackIndex}
                {...(currentTrack?.id != null && { currentTrackId: currentTrack.id })}
                onTrackSelect={handleTrackSelect}
                onRemoveTrack={handleRemoveTrackFromView}
                onRemoveMultipleTracks={handleRemoveMultipleTracksFromView}
                onDropFiles={handleDropFiles}
                onDropFilePaths={handleViewDropFilePaths}
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
                pendingLocateSlot={pendingSlotLocate?.slot}
                pendingLocateToken={pendingSlotLocate?.token}
                onPendingLocatePrepared={handleSlotLocatePrepared}
                onSlotContentReady={handleSlotContentReady}
                filterType={slots[viewSlot].filterType}
                categorySelection={slots[viewSlot].categorySelection}
                onFilterTypeChange={handleFilterTypeChange}
                onCategoryChange={handleCategoryChange}
                onHeaderHeightChange={setHeaderHeight}
                onLoadCloudTracks={loadCloudTracks}
                onMergeCloudTracks={mergeCloudTracks}
	                searchBox={
	                  <SearchBox
	                    isWindowFocused={isWindowFocused}
	                    localTracks={slots.local.tracks}
	                    cloudTracks={slots.cloud.tracks}
	                    onNavigateToTrack={handleSearchNavigate}
	                    onOnlineDownload={handleOnlineDownload}
	                    onOnlineUpload={handleOnlineUpload}
	                    onlineProgress={onlineProgress}
	                  />
                }
              />
              </div>
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
