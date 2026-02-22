import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Track, ViewMode } from './types';
import { getDesktopAPIAsync, isDesktop, type DesktopAPI } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';
import { coverArtService } from './services/coverArtService';
import { libraryStorage } from './services/libraryStorage';
import { buildLibraryIndexData } from './services/librarySerializer';
import { logger } from './services/logger';
import { useBlobUrls } from './hooks/useBlobUrls';
import { usePlayback } from './hooks/usePlayback';
import { useLibraryLoad } from './hooks/useLibraryLoad';
import { useImport } from './hooks/useImport';
import { useLibraryActions } from './hooks/useLibraryActions';

// Components
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import BrowseView from './components/BrowseView';
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
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [forceUpdateCounter] = useState(0); // Force re-render after restore
  const [searchInputValue, setSearchInputValue] = useState(''); // Global search input value (shared between views)
  const [searchTrigger, setSearchTrigger] = useState(0); // Trigger to execute search
  const [libraryScrollPosition, setLibraryScrollPosition] = useState(0); // Save LibraryView scroll position
  const [autoLocateToken, setAutoLocateToken] = useState(0); // Increment only when track is switched by playback actions
  const isFirstLibraryLoadRef = useRef(true); // Track if LibraryView is loading for the first time

  const { activeBlobUrlsRef, createTrackedBlobUrl, revokeBlobUrl } = useBlobUrls();
  const handleTrackSwitch = useCallback(() => {
    setAutoLocateToken(prev => prev + 1);
  }, []);

  const playback = usePlayback({
    tracks,
    setTracks,
    currentTrackIndex,
    setCurrentTrackIndex,
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
    shouldAutoPlayRef,
    restoredTimeRef,
    restoredTrackIdRef,
    persistedTimeRef
  } = playback;

  const {
    fileInputRef,
    handleDesktopImport,
    handleDropFiles,
    handleDropFilePaths,
    handleFileInputChange
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
    persistedTimeRef
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
      playbackMode: playbackMode
    });
    await libraryStorage.saveLibrary(libraryData);
    logger.debug('[App] Library saved after download');
  }, [tracks, setTracks, volume, currentTrackIndex, currentTrack, currentTime, isPlaying, playbackMode, persistedTimeRef]);

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
      coverArtService.revokeAllBlobUrls();
    };
  }, [activeBlobUrlsRef]);

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background-dark font-sans relative">
        <TitleBar />
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

        <main className="flex-1 flex flex-col relative overflow-hidden bg-gradient-to-br from-background-dark to-[#1a2533] pt-8">
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

          <div className="flex-1 p-10 overflow-hidden pt-10">
            {viewMode === ViewMode.BROWSE ? (
              <BrowseView
                inputValue={searchInputValue}
                searchTrigger={searchTrigger}
                onDownloadComplete={handleDownloadComplete}
              />
            ) : (
              <LibraryView
                tracks={tracks}
                currentTrackIndex={currentTrackIndex}
                onTrackSelect={selectTrack}
                onRemoveTrack={handleRemoveTrack}
                onRemoveMultipleTracks={handleRemoveMultipleTracks}
                onDropFiles={handleDropFiles}
                onDropFilePaths={handleDropFilePaths}
                isFocusMode={isFocusMode}
                inputValue={searchInputValue}
                searchTrigger={searchTrigger}
                savedScrollPosition={libraryScrollPosition}
                onScrollPositionChange={setLibraryScrollPosition}
                isFirstLoad={isFirstLibraryLoadRef.current}
                autoLocateToken={autoLocateToken}
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
        />
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;
