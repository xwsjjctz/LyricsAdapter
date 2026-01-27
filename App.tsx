
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Track, ViewMode } from './types';
import { parseAudioFile, libraryStorage } from './services/metadataService';
import { getDesktopAPI, isDesktop } from './services/desktopAdapter';

// Components
import Sidebar from './components/Sidebar';
import LibraryView from './components/LibraryView';
import Controls from './components/Controls';
import FocusMode from './components/FocusMode';

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
      validateFilePath: (filePath: string) => Promise<boolean>;
      validateAllPaths: (songs: any[]) => Promise<{ success: boolean; results: any[]; error?: string }>;
      saveAudioFile: (sourcePath: string, fileName: string) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
      saveAudioFileFromBuffer: (fileName: string, fileData: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; method?: string; error?: string }>;
      deleteAudioFile: (filePath: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
    };
  }
}

// Check if running in Electron (for backwards compatibility)
const isElectron = () => {
  return window.electron !== undefined;
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

  // Callback ref to ensure volume is set when audio element is created
  const setAudioRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    if (node) {
      console.log('Audio element created, setting volume to:', volume);
      node.volume = volume;
    }
  }, [volume]);

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

  const handleFileImport = async (e?: React.ChangeEvent<HTMLInputElement>) => {
    // In Desktop (Electron/Tauri), use native file picker dialog to get file paths (for symlink support)
    const desktopAPI = getDesktopAPI();
    if (desktopAPI) {
      try {
        const result = await desktopAPI.selectFiles();
        if (result.canceled || result.filePaths.length === 0) {
          return;
        }

        const filePaths = result.filePaths;

        for (const filePath of filePaths) {
          const fileName = filePath.split(/[/\\]/).pop() || '';

          // Check if file already exists (by name)
          const existingIndex = tracks.findIndex(track =>
            (track as any).fileName === fileName
          );

          // Create symlink to the original file
          let savedFilePath = '';
          try {
            const saveResult = await desktopAPI.saveAudioFile(filePath, fileName);
            if (saveResult.success && saveResult.filePath) {
              savedFilePath = saveResult.filePath;
              console.log(`File saved (${saveResult.method}):`, savedFilePath);
            }
          } catch (error) {
            console.error('Failed to save file to userData:', error);
          }

          // Read the saved file to create File object and parse metadata
          if (savedFilePath) {
            try {
              const readResult = await desktopAPI.readFile(savedFilePath);
              if (readResult.success) {
                const fileData = new Uint8Array(readResult.data);
                const file = new File([fileData], fileName, { type: 'audio/flac' });

                // Parse metadata
                const metadata = await parseAudioFile(file);
                const currentTime = new Date().toISOString();

                if (existingIndex !== -1) {
                  // Update existing track
                  setTracks(prev => {
                    const newTracks = [...prev];
                    newTracks[existingIndex] = {
                      ...newTracks[existingIndex],
                      ...metadata,
                      file: file,
                      fileName: fileName,
                      fileSize: file.size,
                      lastModified: file.lastModified,
                      filePath: savedFilePath,
                      available: true
                    };
                    return newTracks;
                  });
                } else {
                  // Add new track
                  const newTrack: Track = {
                    id: Math.random().toString(36).substr(2, 9),
                    ...metadata,
                    file: file,
                    fileName: fileName,
                    fileSize: file.size,
                    lastModified: file.lastModified,
                    filePath: savedFilePath,
                    addedAt: currentTime,
                    available: true
                  };
                  setTracks(prev => [...prev, newTrack]);
                }
              }
            } catch (error) {
              console.error('Failed to read and parse file:', filePath, error);
            }
          }
        }
      } catch (error) {
        console.error('Failed to import files:', error);
      }
      return;
    }

    // Web version: use input element (only copies files, no symlinks)
    const files = Array.from(e?.target.files || []) as File[];

    for (const file of files) {
      // Check if file already exists (by name and size)
      const existingIndex = tracks.findIndex(track =>
        (track as any).fileName === file.name && track.file?.size === file.size
      );

      const metadata = await parseAudioFile(file);
      const currentTime = new Date().toISOString();

      // Add new track (web version doesn't persist file paths)
      if (existingIndex === -1) {
        const newTrack: Track = {
          id: Math.random().toString(36).substr(2, 9),
          ...metadata,
          file: file,
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          filePath: '',
          addedAt: currentTime,
          available: true
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
      console.log('Volume changed to:', volume);
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Load library from disk on mount (Electron only)
  useEffect(() => {
    const loadLibraryFromDisk = async () => {
      const desktopAPI = getDesktopAPI();
      if (!desktopAPI) {
        console.log('Not running in Desktop mode, skipping library load');
        return;
      }

      try {
        const libraryData = await libraryStorage.loadLibrary();
        console.log('Library loaded from disk:', libraryData);

        // Restore volume from settings
        if (libraryData.settings?.volume !== undefined) {
          console.log('Restoring volume:', libraryData.settings.volume);
          setVolume(libraryData.settings.volume);
        }

        if (libraryData.songs && libraryData.songs.length > 0) {
          // Validate file paths first
          const validationResults = await libraryStorage.validateAllPaths(libraryData.songs);
          const missingFiles = validationResults.filter(r => !r.exists);

          if (missingFiles.length > 0) {
            console.warn(`Found ${missingFiles.length} missing files`);
          }

          // Progressive loading: load tracks one by one with delay
          const loadedTracks: Track[] = [];
          const delayBetweenTracks = 100; // 100ms delay between each track

          for (let i = 0; i < libraryData.songs.length; i++) {
            const track = libraryData.songs[i];
            const validationResult = validationResults.find(r => r.id === track.id);
            const exists = validationResult?.exists ?? false;

            let restoredTrack: Track;

            if (!exists) {
              // File doesn't exist, mark as unavailable
              restoredTrack = {
                ...track,
                audioUrl: '',
                coverUrl: '',
                available: false
              };
            } else {
              // File exists, read it and create blob URLs
              try {
                const readResult = await desktopAPI.readFile(track.filePath);
                if (readResult.success) {
                  const fileData = new Uint8Array(readResult.data);
                  const file = new File([fileData], track.fileName, { type: 'audio/flac' });

                  // Parse metadata to get cover art
                  const metadata = await parseAudioFile(file);

                  restoredTrack = {
                    ...track,
                    ...metadata,
                    file: file,
                    audioUrl: metadata.audioUrl,
                    coverUrl: metadata.coverUrl,
                    available: true
                  };
                } else {
                  throw new Error('Failed to read file');
                }
              } catch (error) {
                console.error('Failed to read file:', track.filePath, error);
                restoredTrack = {
                  ...track,
                  audioUrl: '',
                  coverUrl: '',
                  available: false
                };
              }
            }

            // Add to tracks array
            loadedTracks.push(restoredTrack);
            setTracks([...loadedTracks]);

            // Add delay between tracks (except for the last one)
            if (i < libraryData.songs.length - 1) {
              await new Promise(resolve => setTimeout(resolve, delayBetweenTracks));
            }
          }
        }
      } catch (error) {
        console.error('Failed to load library:', error);
      }
    };

    loadLibraryFromDisk();
  }, []);

  // Auto-save library to disk when tracks change (Desktop only, debounced)
  useEffect(() => {
    if (isDesktop()) {
      console.log('🔄 Tracks or volume changed, triggering auto-save...');

      // Prepare library data for saving
      const libraryData = {
        songs: tracks.map(track => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          lyrics: track.lyrics,
          syncedLyrics: track.syncedLyrics,
          filePath: (track as any).filePath || '',
          fileName: (track as any).fileName || '',
          fileSize: (track as any).fileSize || 0,
          lastModified: (track as any).lastModified || 0,
          addedAt: (track as any).addedAt || new Date().toISOString(),
          playCount: (track as any).playCount || 0,
          lastPlayed: (track as any).lastPlayed || null,
          available: track.available ?? true
        })),
        settings: {
          volume: volume
        }
      };

      console.log(`📦 Prepared library data: ${libraryData.songs.length} songs, volume: ${libraryData.settings.volume}`);

      // Debounced save
      libraryStorage.saveLibraryDebounced(libraryData);
    }
  }, [tracks, volume]);

  // Save library before app quits
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (isDesktop()) {
        const libraryData = {
          songs: tracks.map(track => ({
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            lyrics: track.lyrics,
            syncedLyrics: track.syncedLyrics,
            filePath: (track as any).filePath || '',
            fileName: (track as any).fileName || '',
            fileSize: (track as any).fileSize || 0,
            lastModified: (track as any).lastModified || 0,
            addedAt: (track as any).addedAt || new Date().toISOString(),
            playCount: (track as any).playCount || 0,
            lastPlayed: (track as any).lastPlayed || null,
            available: track.available ?? true
          })),
          settings: {
            volume: volume
          }
        };

        // Immediate save (no debounce) on quit
        console.log('💾 Saving library before quit...');
        await libraryStorage.saveLibrary(libraryData);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tracks, volume]);

  // Remove track function
  const handleRemoveTrack = useCallback(async (trackId: string) => {
    // In Desktop (Electron/Tauri), delete the symlink file first
    const desktopAPI = getDesktopAPI();
    if (desktopAPI) {
      const trackToRemove = tracks.find(t => t.id === trackId);
      if (trackToRemove && (trackToRemove as any).filePath) {
        try {
          const result = await desktopAPI.deleteAudioFile((trackToRemove as any).filePath);
          if (result.success) {
            console.log(`✅ Symlink deleted for track: ${trackToRemove.title}`);
          }
        } catch (error) {
          console.error('Failed to delete symlink:', error);
          // Continue with track removal even if symlink deletion fails
        }
      }
    }

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
  }, [currentTrackIndex, tracks, isDesktop]);

  // Reload files in Desktop (Electron/Tauri)
  const handleReloadFiles = useCallback(async () => {
    const desktopAPI = getDesktopAPI();
    if (!desktopAPI) return;

    try {
      const result = await desktopAPI.selectFiles();
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
            // Create symlink to the original file
            const saveResult = await desktopAPI.saveAudioFile(filePath, fileName);
            if (saveResult.success && saveResult.filePath) {
              console.log(`File saved (${saveResult.method}):`, saveResult.filePath);

              // Read the saved file to create File object
              const readResult = await desktopAPI.readFile(saveResult.filePath);
              if (readResult.success) {
                const fileData = new Uint8Array(readResult.data);
                const file = new File([fileData], fileName, { type: 'audio/flac' });

                // Parse metadata
                const metadata = await parseAudioFile(file);

                // Update track with file path
                updatedTracks[trackIndex] = {
                  ...updatedTracks[trackIndex],
                  ...metadata,
                  file: file,
                  filePath: saveResult.filePath, // Store the saved file path (symlink)
                  fileName: fileName,
                  fileSize: file.size,
                  lastModified: file.lastModified,
                  available: true
                };
                reloadedCount++;
              }
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
        onImportClick={() => isDesktop() ? handleFileImport() : fileInputRef.current?.click()}
        onNavigate={(mode) => { setViewMode(mode); setIsFocusMode(false); }}
        onReloadFiles={handleReloadFiles}
        hasUnavailableTracks={tracks.some(t => t.available === false)}
        currentView={viewMode}
      />

      <main className="flex-1 flex flex-col relative overflow-hidden bg-gradient-to-br from-background-dark to-[#1a2533]">
        {currentTrack && (
          <audio
            ref={setAudioRef}
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
