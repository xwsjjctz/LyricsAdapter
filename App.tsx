
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Track, ViewMode } from './types';
import { parseAudioFile } from './services/metadataService';

// Components
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import Controls from './components/Controls';
import FocusMode from './components/FocusMode';

// LocalStorage key
const STORAGE_KEY = 'lyricsadapter_tracks';

// Electron API type
declare global {
  interface Window {
    electron?: {
      platform: string;
      readFile: (filePath: string) => Promise<{ success: boolean; data: ArrayBuffer; error?: string }>;
      checkFileExists: (filePath: string) => Promise<boolean>;
      selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>;
    };
  }
}

// Check if running in Electron
const isElectron = () => {
  return window.electron !== undefined;
};

// Save tracks to localStorage
const saveTracks = (tracks: Track[]) => {
  try {
    const tracksToSave = tracks.map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      lyrics: track.lyrics,
      syncedLyrics: track.syncedLyrics,
      fileName: (track as any).fileName, // Save filename for matching
      available: track.available // Save availability state
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tracksToSave));
  } catch (error) {
    console.error('Failed to save tracks:', error);
  }
};

// Load tracks from localStorage
const loadTracks = (): any[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load tracks:', error);
  }
  return [];
};

const App: React.FC = () => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const [isFocusMode, setIsFocusMode] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentTrack = currentTrackIndex >= 0 ? tracks[currentTrackIndex] : null;

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error("Playback failed", e));
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, currentTrack]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current && currentTrack) {
      // Always update duration from audio element if metadata missed it or to be precise
      setTracks(prev => {
        const newTracks = [...prev];
        if (newTracks[currentTrackIndex] && audioRef.current) {
          newTracks[currentTrackIndex] = {
            ...newTracks[currentTrackIndex],
            duration: audioRef.current.duration
          };
        }
        return newTracks;
      });
    }
  };

  const handleTrackEnded = useCallback(() => {
    if (currentTrackIndex < tracks.length - 1) {
      setCurrentTrackIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, [currentTrackIndex, tracks.length]);

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];

    for (const file of files) {
      // Check if file already exists (by name and size)
      const existingIndex = tracks.findIndex(track =>
        track.file?.name === file.name && track.file?.size === file.size
      );

      const metadata = await parseAudioFile(file);

      if (existingIndex !== -1) {
        // Update existing track (re-import scenario)
        setTracks(prev => {
          const newTracks = [...prev];
          newTracks[existingIndex] = {
            ...newTracks[existingIndex],
            ...metadata,
            file: file,
            fileName: file.name
          };
          return newTracks;
        });
      } else {
        // Add new track
        const newTrack: Track = {
          id: Math.random().toString(36).substr(2, 9),
          ...metadata,
          file: file,
          fileName: file.name
        };
        setTracks(prev => [...prev, newTrack]);
      }
    }

    // Reset input value so same file can be imported again if needed
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const skipForward = useCallback(() => {
    if (currentTrackIndex < tracks.length - 1) {
      setCurrentTrackIndex(prev => prev + 1);
    }
  }, [currentTrackIndex, tracks.length]);

  const skipBackward = useCallback(() => {
    if (currentTrackIndex > 0) {
      setCurrentTrackIndex(prev => prev - 1);
    } else if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  }, [currentTrackIndex]);

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  useEffect(() => {
    if (audioRef.current && currentTrack) {
      if (isPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      } else {
        audioRef.current.pause();
      }
    }
  }, [currentTrackIndex, isPlaying, currentTrack]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Load tracks from localStorage on mount (Electron only)
  useEffect(() => {
    if (isElectron()) {
      const savedTracks = loadTracks();
      if (savedTracks.length > 0) {
        console.log('Loading saved tracks:', savedTracks.length);
        // Load saved tracks metadata with preserved availability
        setTracks(savedTracks.map((track: any) => ({
          ...track,
          audioUrl: '', /* Blob URLs don't persist */
          coverUrl: '', /* Blob URLs don't persist */
          available: track.available !== undefined ? track.available : false /* Preserve saved state or default to false */
        })));
      }
    }
  }, []);

  // Save tracks to localStorage when they change (Electron only)
  useEffect(() => {
    if (isElectron() && tracks.length > 0) {
      saveTracks(tracks);
    }
  }, [tracks]);

  // Remove track function
  const handleRemoveTrack = useCallback((trackId: string) => {
    setTracks(prev => {
      const newTracks = prev.filter(t => t.id !== trackId);
      // Update current track index if needed
      if (currentTrackIndex >= newTracks.length) {
        setCurrentTrackIndex(Math.max(0, newTracks.length - 1));
      } else if (newTracks.length === 0) {
        setCurrentTrackIndex(-1);
        setIsPlaying(false);
      }
      return newTracks;
    });
  }, [currentTrackIndex]);

  // Reload files in Electron
  const handleReloadFiles = useCallback(async () => {
    if (!window.electron) return;

    try {
      const result = await window.electron.selectFiles();
      if (result.canceled || result.filePaths.length === 0) {
        return;
      }

      const filePaths = result.filePaths;
      const updatedTracks = [...tracks];
      let reloadedCount = 0;

      // Match files with existing tracks by filename
      for (const filePath of filePaths) {
        const fileName = filePath.split(/[/\\]/).pop() || '';

        // Find matching track by stored filename
        const trackIndex = updatedTracks.findIndex(t => {
          const storedFileName = (t as any).fileName;
          return storedFileName === fileName;
        });

        if (trackIndex !== -1 && !updatedTracks[trackIndex].available) {
          // File found, reload it
          try {
            const readResult = await window.electron.readFile(filePath);
            if (readResult.success) {
              // Create File object from ArrayBuffer
              const fileData = new Uint8Array(readResult.data);
              const file = new File([fileData], fileName, { type: 'audio/flac' });

              // Parse metadata
              const metadata = await parseAudioFile(file);

              // Update track
              updatedTracks[trackIndex] = {
                ...updatedTracks[trackIndex],
                ...metadata,
                file: file,
                available: true
              };
              reloadedCount++;
            }
          } catch (error) {
            console.error('Failed to reload file:', filePath, error);
          }
        }
      }

      setTracks(updatedTracks);
      console.log(`Reloaded ${reloadedCount} files`);
    } catch (error) {
      console.error('Failed to reload files:', error);
    }
  }, [tracks]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background-dark font-sans relative">
      <Sidebar
        onImportClick={() => fileInputRef.current?.click()}
        onNavigate={(mode) => { setViewMode(mode); setIsFocusMode(false); }}
        onReloadFiles={handleReloadFiles}
        hasUnavailableTracks={tracks.some(t => t.available === false)}
        currentView={viewMode}
      />

      <main className="flex-1 flex flex-col relative overflow-hidden bg-gradient-to-br from-background-dark to-[#1a2533]">
        {currentTrack && (
          <audio
            ref={audioRef}
            src={currentTrack.audioUrl}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={handleTrackEnded}
          />
        )}

        <input 
          type="file" 
          ref={fileInputRef} 
          multiple 
          accept=".flac,.mp3,.m4a,.wav" 
          className="hidden" 
          onChange={handleFileImport}
        />

        <div className="flex-1 p-10 overflow-hidden">
          <LibraryView
            tracks={tracks}
            currentTrackIndex={currentTrackIndex}
            onTrackSelect={(idx) => { setCurrentTrackIndex(idx); setIsPlaying(true); }}
            onRemoveTrack={handleRemoveTrack}
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
          onVolumeChange={setVolume}
          onToggleFocus={() => setIsFocusMode(!isFocusMode)}
          isFocusMode={isFocusMode}
        />
      </main>

      {/* Focus Mode Overlay */}
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
        onVolumeChange={setVolume}
      />
    </div>
  );
};

export default App;
