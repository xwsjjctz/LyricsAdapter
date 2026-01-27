
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Track, ViewMode } from './types';
import { parseAudioFile, libraryStorage } from './services/metadataService';
import { getDesktopAPI, getDesktopAPIAsync, isDesktop } from './services/desktopAdapter';
import { metadataCacheService } from './services/metadataCacheService';

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

  // Initialize Desktop API on mount
  useEffect(() => {
    const initDesktopAPI = async () => {
      console.log('[App] Initializing Desktop API...');
      try {
        const api = await getDesktopAPIAsync();
        if (api) {
          console.log('[App] ✓ Desktop API initialized, platform:', api.platform);
        } else {
          console.log('[App] No Desktop API available (running in browser)');
        }
      } catch (error) {
        console.error('[App] Failed to initialize Desktop API:', error);
      }
    };

    initDesktopAPI();
  }, []);

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

  // Helper function to load audio file for a track (lazy loading)
  // Optimized: Use readFile but show loading state
  const loadAudioFileForTrack = useCallback(async (track: Track): Promise<Track> => {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI || !(track as any).filePath || track.audioUrl) {
      return track; // Already loaded or no desktop API
    }

    try {
      console.log('[App] Loading audio file for:', track.title);
      const readResult = await desktopAPI.readFile((track as any).filePath);

      if (readResult.success && readResult.data.byteLength > 0) {
        const fileData = new Uint8Array(readResult.data);
        const file = new File([fileData], (track as any).fileName, { type: 'audio/flac' });
        const audioUrl = URL.createObjectURL(file);

        console.log('[App] ✓ Audio loaded, size:', fileData.length);

        return {
          ...track,
          file: file,
          audioUrl: audioUrl,
        };
      } else {
        console.error('[App] Failed to load audio file:', readResult.error);
        return track;
      }
    } catch (error) {
      console.error('[App] Failed to load audio file:', error);
      return track;
    }
  }, []);

  // Desktop import handler (uses native file dialog for both Electron and Tauri)
  const handleDesktopImport = async () => {
    console.log('[App] Desktop import triggered');
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI) {
      console.error('[App] Desktop API not available');
      return;
    }

    try {
      const result = await desktopAPI.selectFiles();
      if (result.canceled || result.filePaths.length === 0) {
        return;
      }

      const filePaths = result.filePaths;

      for (const filePath of filePaths) {
        const fileName = filePath.split(/[/\\]/).pop() || '';
        const existingIndex = tracks.findIndex(track =>
          (track as any).fileName === fileName
        );

        // Create symlink
        let savedFilePath = '';
        const saveResult = await desktopAPI.saveAudioFile(filePath, fileName);
        if (saveResult?.success && saveResult?.filePath) {
          savedFilePath = saveResult.filePath;
        }

        if (savedFilePath) {
          // Parse with Rust
          const parseResult = await desktopAPI.parseAudioMetadata(savedFilePath);

          if (parseResult.success && parseResult.metadata) {
            const metadata = parseResult.metadata;
            const trackId = existingIndex !== -1 ? tracks[existingIndex].id : Math.random().toString(36).substr(2, 9);

            // Cache metadata
            metadataCacheService.set(trackId, {
              title: metadata.title,
              artist: metadata.artist,
              album: metadata.album,
              duration: metadata.duration,
              lyrics: metadata.lyrics,
              syncedLyrics: metadata.syncedLyrics,
              coverData: metadata.coverData,
              coverMime: metadata.coverMime,
              fileName: fileName,
              fileSize: 1,
              lastModified: Date.now(),
            });
            metadataCacheService.save();

            // Create cover URL
            let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(fileName)}/1000/1000`;
            if (metadata.coverData && metadata.coverMime) {
              const byteCharacters = atob(metadata.coverData);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: metadata.coverMime });
              coverUrl = URL.createObjectURL(blob);
            }

            if (existingIndex !== -1) {
              setTracks(prev => {
                const newTracks = [...prev];
                newTracks[existingIndex] = {
                  ...newTracks[existingIndex],
                  title: metadata.title,
                  artist: metadata.artist,
                  album: metadata.album,
                  duration: metadata.duration,
                  lyrics: metadata.lyrics,
                  syncedLyrics: metadata.syncedLyrics,
                  coverUrl: coverUrl,
                  fileName: fileName,
                  filePath: savedFilePath,
                  available: true
                };
                return newTracks;
              });
            } else {
              const newTrack: Track = {
                id: trackId,
                title: metadata.title,
                artist: metadata.artist,
                album: metadata.album,
                duration: metadata.duration,
                lyrics: metadata.lyrics,
                syncedLyrics: metadata.syncedLyrics,
                coverUrl: coverUrl,
                audioUrl: '',
                fileName: fileName,
                filePath: savedFilePath,
                addedAt: new Date().toISOString(),
                available: true
              };
              setTracks(prev => [...prev, newTrack]);
            }
          }
        }
      }
    } catch (error) {
      console.error('[App] Failed to import files:', error);
    }
  };

  // File input change handler (for Electron and Web)
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    console.log('[App] File input changed - platform:', (window as any).electron ? 'Electron' : (window as any).__TAURI__ ? 'Tauri' : 'Web');
    console.log('[App] Files selected:', files.length);

    for (const file of files) {
      // Check if file already exists (by name and size)
      const existingIndex = tracks.findIndex(track =>
        track.file?.name === file.name && track.file?.size === file.size
      );

      const metadata = await parseAudioFile(file);

      if (existingIndex !== -1) {
        // Update existing track
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

    // Reset input value
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
      // Load audio file if not loaded yet (lazy loading)
      if (!currentTrack.audioUrl && (currentTrack as any).filePath) {
        console.log('[App] Lazy loading audio for:', currentTrack.title);
        loadAudioFileForTrack(currentTrack).then(updatedTrack => {
          setTracks(prev => {
            const newTracks = [...prev];
            const idx = newTracks.findIndex(t => t.id === updatedTrack.id);
            if (idx !== -1) {
              newTracks[idx] = updatedTrack;
            }
            return newTracks;
          });
        });
      }

      if (isPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      } else {
        audioRef.current.pause();
      }
    }
  }, [currentTrackIndex, isPlaying, currentTrack, loadAudioFileForTrack]);

  // Preload adjacent tracks for instant playback
  useEffect(() => {
    const preloadAdjacent = async () => {
      if (currentTrackIndex < 0 || !isDesktop()) return;

      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) return;

      // Preload next track
      if (currentTrackIndex < tracks.length - 1) {
        const nextTrack = tracks[currentTrackIndex + 1];
        if (!nextTrack.audioUrl && (nextTrack as any).filePath) {
          console.log('[App] Preloading next track:', nextTrack.title);
          loadAudioFileForTrack(nextTrack).then(updatedTrack => {
            setTracks(prev => {
              const newTracks = [...prev];
              newTracks[currentTrackIndex + 1] = updatedTrack;
              return newTracks;
            });
          });
        }
      }

      // Preload previous track
      if (currentTrackIndex > 0) {
        const prevTrack = tracks[currentTrackIndex - 1];
        if (!prevTrack.audioUrl && (prevTrack as any).filePath) {
          console.log('[App] Preloading previous track:', prevTrack.title);
          loadAudioFileForTrack(prevTrack).then(updatedTrack => {
            setTracks(prev => {
              const newTracks = [...prev];
              newTracks[currentTrackIndex - 1] = updatedTrack;
              return newTracks;
            });
          });
        }
      }
    };

    // Small delay to not interfere with current track loading
    const timer = setTimeout(preloadAdjacent, 500);
    return () => clearTimeout(timer);
  }, [currentTrackIndex, tracks, isDesktop, loadAudioFileForTrack]);

  useEffect(() => {
    if (audioRef.current) {
      console.log('Volume changed to:', volume);
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Load library from disk on mount (Desktop only)
  useEffect(() => {
    const loadLibraryFromDisk = async () => {
      console.log('[App] Loading library from disk...');
      // Initialize metadata cache first
      await metadataCacheService.initialize();

      // Wait for Desktop API to be initialized
      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) {
        console.log('[App] Not running in Desktop mode, skipping library load');
        return;
      }

      try {
        const libraryData = await libraryStorage.loadLibrary();
        console.log('[App] Library loaded from disk:', libraryData);

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

          // Progressive loading with immediate UI updates
          const BATCH_SIZE = 20; // Load 20 songs at a time before UI update
          let loadedTracks: Track[] = [];

          for (let i = 0; i < libraryData.songs.length; i++) {
            const song = libraryData.songs[i];
            const validationResult = validationResults.find(r => r.id === song.id);
            const exists = validationResult?.exists ?? false;

            let restoredTrack: Track;

            if (!exists) {
              // File doesn't exist, mark as unavailable
              restoredTrack = {
                ...song,
                audioUrl: '',
                coverUrl: '',
                available: false
              };
            } else {
              // File exists, try to get metadata from cache first
              const cached = metadataCacheService.get(song.id);
              const isValid = cached && metadataCacheService.isValid(
                song.id,
                song.fileName,
                song.fileSize,
                song.lastModified
              );

              if (isValid && cached) {
                // Use cached metadata (fast path!)
                console.log(`[App] ✓ Using cached metadata for: ${song.title}`);
                const cachedMetadata = metadataCacheService.cachedToTrack(cached, song.filePath, song.id);

                restoredTrack = {
                  ...song,
                  ...cachedMetadata,
                  file: undefined, // Don't load file yet
                  audioUrl: '', // Will be loaded on play
                  coverUrl: cachedMetadata.coverUrl || `https://picsum.photos/seed/${encodeURIComponent(song.fileName)}/1000/1000`,
                  available: true
                };
              } else {
                // No cache or invalid, parse with Rust NOW (fast!)
                console.log(`[App] No cache for: ${song.title}, parsing with Rust...`);
                let parsedMetadata = null;

                try {
                  const parseResult = await desktopAPI.parseAudioMetadata(song.filePath);
                  if (parseResult.success && parseResult.metadata) {
                    parsedMetadata = parseResult.metadata;

                    // Cache the parsed metadata
                    metadataCacheService.set(song.id, {
                      title: parsedMetadata.title,
                      artist: parsedMetadata.artist,
                      album: parsedMetadata.album,
                      duration: parsedMetadata.duration,
                      lyrics: parsedMetadata.lyrics,
                      syncedLyrics: parsedMetadata.syncedLyrics,
                      coverData: parsedMetadata.coverData,
                      coverMime: parsedMetadata.coverMime,
                      fileName: song.fileName,
                      fileSize: 1,
                      lastModified: Date.now(),
                    });
                  }
                } catch (e) {
                  console.error('[App] Failed to parse with Rust:', e);
                }

                if (parsedMetadata) {
                  // Use parsed metadata
                  let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(song.fileName)}/1000/1000`;
                  if (parsedMetadata.coverData && parsedMetadata.coverMime) {
                    const byteCharacters = atob(parsedMetadata.coverData);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: parsedMetadata.coverMime });
                    coverUrl = URL.createObjectURL(blob);
                  }

                  restoredTrack = {
                    ...song,
                    title: parsedMetadata.title,
                    artist: parsedMetadata.artist,
                    album: parsedMetadata.album,
                    duration: parsedMetadata.duration,
                    lyrics: parsedMetadata.lyrics,
                    syncedLyrics: parsedMetadata.syncedLyrics,
                    audioUrl: '', // Will be loaded on play
                    coverUrl: coverUrl,
                    available: true
                  };
                } else {
                  // Parse failed, use placeholder
                  restoredTrack = {
                    ...song,
                    audioUrl: '', // Will be loaded on play
                    coverUrl: `https://picsum.photos/seed/${encodeURIComponent(song.fileName)}/1000/1000`,
                    available: true
                  };
                }
              }
            }

            // Add to tracks array
            loadedTracks.push(restoredTrack);

            // Update UI every BATCH_SIZE songs or at the end
            if (loadedTracks.length % BATCH_SIZE === 0 || i === libraryData.songs.length - 1) {
              setTracks([...loadedTracks]);
              console.log(`[App] ✓ Loaded ${loadedTracks.length}/${libraryData.songs.length} tracks`);
              // Small delay to let UI render
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }

          // Save cache if we updated it
          await metadataCacheService.save();
          console.log(`[App] ✓ Finished loading ${loadedTracks.length} tracks`);

          // Preload first 3 songs for instant playback
          const PRELOAD_COUNT = 3;
          const tracksToPreload = Math.min(PRELOAD_COUNT, loadedTracks.length);

          for (let i = 0; i < tracksToPreload; i++) {
            const track = loadedTracks[i];
            if ((track as any).filePath && !track.audioUrl) {
              console.log(`[App] Preloading song ${i + 1}/${PRELOAD_COUNT}:`, track.title);
              // Don't await - let them load in parallel
              loadAudioFileForTrack(track).then(updatedTrack => {
                setTracks(prev => {
                  const newTracks = [...prev];
                  const idx = newTracks.findIndex(t => t.id === updatedTrack.id);
                  if (idx !== -1) {
                    newTracks[idx] = updatedTrack;
                  }
                  return newTracks;
                });
              });
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
    const desktopAPI = await getDesktopAPIAsync();
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
    const desktopAPI = await getDesktopAPIAsync();
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
          // File found, reload it using Rust
          try {
            // Create symlink to the original file
            const saveResult = await desktopAPI.saveAudioFile(filePath, fileName);
            if (saveResult.success && saveResult.filePath) {
              console.log(`File saved (${saveResult.method}):`, saveResult.filePath);

              // Parse metadata using Rust (FAST!)
              const parseResult = await desktopAPI.parseAudioMetadata(saveResult.filePath);
              if (parseResult.success && parseResult.metadata) {
                const metadata = parseResult.metadata;

                // Update cache with Rust metadata
                metadataCacheService.set(updatedTracks[trackIndex].id, {
                  title: metadata.title,
                  artist: metadata.artist,
                  album: metadata.album,
                  duration: metadata.duration,
                  lyrics: metadata.lyrics,
                  syncedLyrics: metadata.syncedLyrics,
                  coverData: metadata.coverData,
                  coverMime: metadata.coverMime,
                  fileName: fileName,
                  fileSize: 1,
                  lastModified: Date.now(),
                });

                // Create cover URL from base64 if available
                let coverUrl = `https://picsum.photos/seed/${encodeURIComponent(fileName)}/1000/1000`;
                if (metadata.coverData && metadata.coverMime) {
                  const byteCharacters = atob(metadata.coverData);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  const blob = new Blob([byteArray], { type: metadata.coverMime });
                  coverUrl = URL.createObjectURL(blob);
                }

                // Update track with metadata
                updatedTracks[trackIndex] = {
                  ...updatedTracks[trackIndex],
                  title: metadata.title,
                  artist: metadata.artist,
                  album: metadata.album,
                  duration: metadata.duration,
                  lyrics: metadata.lyrics,
                  syncedLyrics: metadata.syncedLyrics,
                  coverUrl: coverUrl,
                  filePath: saveResult.filePath,
                  fileName: fileName,
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

      // Save cache if we updated it
      if (reloadedCount > 0) {
        await metadataCacheService.save();
      }
    } catch (error) {
      console.error('Failed to reload files:', error);
    }
  }, [tracks]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background-dark font-sans relative">
      <Sidebar
        onImportClick={() => {
          // Check if running in Desktop environment (Electron or Tauri)
          if (isDesktop()) {
            // Desktop: Use native file dialog
            handleDesktopImport();
          } else {
            // Web: Use file input
            fileInputRef.current?.click();
          }
        }}
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
          onChange={handleFileInputChange}
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
