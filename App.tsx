import React, { useEffect, useState } from 'react';
import { Track, ViewMode } from './types';
import { getDesktopAPIAsync, isDesktop } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';
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
import Controls from './components/Controls';
import FocusMode from './components/FocusMode';
import ErrorBoundary from './components/ErrorBoundary';

// Electron API type (for backwards compatibility)
declare global {
  interface Window {
    electron?: {
      platform: string;
      readFile: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; error?: string }>;
      checkFileExists: (filePath: string) => Promise<boolean>;
      selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      loadLibrary: () => Promise<{ success: boolean; library: any; error?: string }>;
      saveLibrary: (library: any) => Promise<{ success: boolean; error?: string }>;
      loadLibraryIndex?: () => Promise<{ success: boolean; library: any; error?: string }>;
      saveLibraryIndex?: (library: any) => Promise<{ success: boolean; error?: string }>;
      validateFilePath: (filePath: string) => Promise<boolean>;
      validateAllPaths: (songs: any[]) => Promise<{ success: boolean; results: any[]; error?: string }>;
      saveAudioFile: (sourcePath: string, fileName: string) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
      saveAudioFileFromBuffer: (fileName: string, fileData: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
      deleteAudioFile: (filePath: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
      cleanupOrphanAudio: (keepPaths: string[]) => Promise<{ success: boolean; removed?: number; error?: string }>;
      saveCoverThumbnail?: (payload: { id: string; data: string; mime: string }) => Promise<{ success: boolean; coverUrl?: string; filePath?: string; error?: string }>;
      deleteCoverThumbnail?: (trackId: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
      // Window control APIs
      minimizeWindow?: () => void;
      maximizeWindow?: () => void;
      closeWindow?: () => void;
      isMaximized?: () => boolean;
    };
  }
}

const App: React.FC = () => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [forceUpdateCounter] = useState(0); // Force re-render after restore

  const { activeBlobUrlsRef, createTrackedBlobUrl, revokeBlobUrl } = useBlobUrls();

  const playback = usePlayback({
    tracks,
    setTracks,
    currentTrackIndex,
    setCurrentTrackIndex,
    createTrackedBlobUrl,
    revokeBlobUrl
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
          onNavigate={(mode) => { setViewMode(mode); setIsFocusMode(false); }}
          onReloadFiles={handleReloadFiles}
          hasUnavailableTracks={tracks.some(t => t.available === false)}
          currentView={viewMode}
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
            <LibraryView
              tracks={tracks}
              currentTrackIndex={currentTrackIndex}
              onTrackSelect={selectTrack}
              onRemoveTrack={handleRemoveTrack}
              onRemoveMultipleTracks={handleRemoveMultipleTracks}
              onDropFiles={handleDropFiles}
              isFocusMode={isFocusMode}
            />
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
