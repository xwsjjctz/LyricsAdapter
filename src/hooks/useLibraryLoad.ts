import { useEffect, useRef } from 'react';
import { Track, LibrarySlot, SlotId } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage } from '../services/libraryStorage';
import type { LibrarySettings, PlaylistsViewPersistence } from '../services/libraryStorage';
import { metadataCacheService } from '../services/metadataCacheService';
import { buildLibraryIndexDataForSlots, buildMinimalTracks, minimalTrackToLibrarySong } from '../services/librarySerializer';
import { logger } from '../services/logger';
import { addLibraryFlushListener } from '../services/libraryFlushEvent';
import { sanitizePersistedCoverUrl } from '../services/coverUrl';
import { appStorage } from '../services/appStorage';

interface UseLibraryLoadOptions {
  restoreFromPersistence: (data: any, tracksFromDisk: Track[], onlineTracks?: Track[]) => void;
  getPersistenceData: () => LibrarySettings;
  getSlotsSnapshot?: () => Record<SlotId, LibrarySlot>;
  slots: Record<SlotId, LibrarySlot>;
  setLocalTracks: (updater: Track[] | ((prev: Track[]) => Track[])) => void;
  loadCloudTracks: (tracks: Track[]) => void;
  loadOnlineTracks: (tracks: Track[]) => void;
  loadPlaylistTracks: (tracks: Track[]) => void;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setVolume: (volume: number) => void;
  setPlaybackMode: (mode: 'order' | 'shuffle' | 'repeat-one') => void;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  persistedTimeRef: React.MutableRefObject<number>;
  onLibrarySettingsRestored?: (settings: { activeSlotId?: SlotId; currentTime?: number; playlistsView?: PlaylistsViewPersistence }) => void;
  updateSlot: (slotId: SlotId, updater: (slot: LibrarySlot) => LibrarySlot) => void;
}

export function useLibraryLoad({
  restoreFromPersistence,
  getPersistenceData,
  getSlotsSnapshot,
  slots,
  setLocalTracks,
  loadCloudTracks,
  loadOnlineTracks,
  loadPlaylistTracks,
  setIsPlaying,
  setVolume,
  setPlaybackMode,
  audioRef,
  persistedTimeRef,
  onLibrarySettingsRestored,
  updateSlot,
}: UseLibraryLoadOptions) {
  const isFirstLoadRef = useRef(true);

  const loadAndRestoreLibrary = async (libraryData: { songs: any[]; cloudSongs?: any[]; onlineSongs?: any[]; playlistSongs?: any[]; settings: any }) => {
    logger.debug('[LibraryLoad] Library data loaded, songs:', libraryData.songs?.length || 0, 'cloud songs:', libraryData.cloudSongs?.length || 0);

    const settings = libraryData.settings || {};
    const loadedTracks: Track[] = (libraryData.songs || []).map((song: any) => {
      const fileName = song.fileName || '';
      const fallbackTitle = song.title || fileName.replace(/\.[^/.]+$/, '');
      return {
        id: song.id,
        title: fallbackTitle,
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'Unknown Album',
        duration: song.duration || 0,
        lyrics: song.lyrics || '',
        syncedLyrics: song.syncedLyrics,
        coverUrl: sanitizePersistedCoverUrl(song.coverUrl),
        audioUrl: '',
        file: undefined,
        fileName: song.fileName,
        filePath: song.filePath,
        fileSize: song.fileSize,
        lastModified: song.lastModified,
        addedAt: song.addedAt,
        playCount: song.playCount,
        lastPlayed: song.lastPlayed || undefined,
        available: song.available ?? true
      } as Track;
    });

    restoreFromPersistence(settings, loadedTracks);

    let restoredCloudTracks: Track[] = [];
    if (libraryData.cloudSongs && libraryData.cloudSongs.length > 0) {
      restoredCloudTracks = libraryData.cloudSongs.map((song: any) => {
        const fileName = song.fileName || '';
        const fallbackTitle = song.title || fileName.replace(/\.[^/.]+$/, '');
        const coverUrl = sanitizePersistedCoverUrl(song.coverUrl);
        return {
          id: song.id,
          title: fallbackTitle,
          artist: song.artist || 'Unknown Artist',
          album: song.album || 'Unknown Album',
          duration: song.duration || 0,
          lyrics: song.lyrics || '',
          syncedLyrics: song.syncedLyrics,
          coverUrl: coverUrl || `https://picsum.photos/seed/${encodeURIComponent(fileName)}/1000/1000`,
          audioUrl: '',
          source: 'webdav' as const,
          webdavPath: song.webdavPath,
          fileName: song.fileName,
          fileSize: song.fileSize,
          lastModified: song.lastModified,
          playCount: song.playCount,
          lastPlayed: song.lastPlayed || undefined,
        } as Track;
      });
      loadCloudTracks(restoredCloudTracks);
      logger.debug('[LibraryLoad] Restored', restoredCloudTracks.length, 'cloud tracks from disk');
    }

    let restoredOnlineTracks: Track[] = [];
    if (libraryData.onlineSongs && libraryData.onlineSongs.length > 0) {
      restoredOnlineTracks = libraryData.onlineSongs.map((song: any) => ({
        id: song.id,
        title: song.title || 'Unknown',
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'Unknown Album',
        duration: song.duration || 0,
        lyrics: song.lyrics || '',
        syncedLyrics: song.syncedLyrics,
        coverUrl: sanitizePersistedCoverUrl(song.coverUrl),
        audioUrl: '',
        source: (song.source as 'qq' | 'netease') ?? undefined,
        songmid: song.songmid,
      } as Track));
      loadOnlineTracks(restoredOnlineTracks);
      logger.debug('[LibraryLoad] Restored', restoredOnlineTracks.length, 'online tracks from disk');
    }

    let restoredPlaylistTracks: Track[] = [];
    if (libraryData.playlistSongs && libraryData.playlistSongs.length > 0) {
      restoredPlaylistTracks = libraryData.playlistSongs.map((song: any) => ({
        id: song.id,
        title: song.title || 'Unknown',
        artist: song.artist || 'Unknown Artist',
        album: song.album || 'Unknown Album',
        duration: song.duration || 0,
        lyrics: song.lyrics || '',
        syncedLyrics: song.syncedLyrics,
        coverUrl: sanitizePersistedCoverUrl(song.coverUrl),
        audioUrl: '',
        source: (song.source as 'qq' | 'netease') ?? undefined,
        songmid: song.songmid,
      } as Track));
      loadPlaylistTracks(restoredPlaylistTracks);
      logger.debug('[LibraryLoad] Restored', restoredPlaylistTracks.length, 'playlist tracks from disk');
    }

    const activeSource = settings.activeSlotId || settings.activeDataSource || 'local';
    const slotData = settings.localSlot || settings.cloudSlot || settings.onlineSlot || settings.playlistSlot ? settings : null;
    const activeSlotState = activeSource === 'cloud'
      ? slotData?.cloudSlot
      : activeSource === 'online'
        ? slotData?.onlineSlot
        : activeSource === 'playlist'
          ? slotData?.playlistSlot
          : slotData?.localSlot;

    if (activeSlotState?.volume !== undefined) {
      updateSlot(activeSource, s => ({ ...s, volume: activeSlotState.volume }));
      setVolume(activeSlotState.volume);
    }
    if (activeSlotState?.playbackMode) {
      updateSlot(activeSource, s => ({ ...s, playbackMode: activeSlotState.playbackMode }));
      setPlaybackMode(activeSlotState.playbackMode);
    }

    setIsPlaying(false);

    metadataCacheService.initialize().catch(err => {
      logger.warn('[LibraryLoad] Metadata cache init failed:', err);
    });

    const desktopAPI = await getDesktopAPIAsync();
    if (desktopAPI?.runStartupCleanup) {
      const ids = [
        ...loadedTracks.map(t => t.id),
        ...restoredCloudTracks.map(t => t.id),
        ...restoredOnlineTracks.map(t => t.id),
        ...restoredPlaylistTracks.map(t => t.id),
      ];
      desktopAPI.runStartupCleanup(ids).catch(err => {
        logger.warn('[LibraryLoad] Startup cleanup failed:', err);
      });
    }

    const restoredSettings: { activeSlotId?: SlotId; currentTime?: number; playlistsView?: PlaylistsViewPersistence } = {
      activeSlotId: activeSource,
      currentTime: activeSlotState?.currentTime ?? 0,
    };
    if (settings.playlistsView) {
      restoredSettings.playlistsView = settings.playlistsView;
    }
    onLibrarySettingsRestored?.(restoredSettings);

    const tracksToValidate = loadedTracks.filter(t => t.filePath);
    if (tracksToValidate.length > 0) {
      libraryStorage.validateAllPaths(tracksToValidate).then(results => {
        const map = new Map(results.map(r => [r.id, r.exists]));
        setLocalTracks(prev => {
          let changed = false;
          const next = prev.map(track => {
            if (!track.filePath) return track;
            const exists = map.get(track.id);
            if (exists === undefined || track.available === exists) return track;
            changed = true;
            return { ...track, available: exists };
          });
          return changed ? next : prev;
        });
      }).catch(err => {
        logger.warn('[LibraryLoad] Background path validation failed:', err);
      });
    }
  };

  useEffect(() => {
    const loadLibraryFromDisk = async () => {
      logger.debug('[LibraryLoad] Loading library from disk...');
      try {
        const libraryData = await libraryStorage.loadLibrary();

        // 如果 library-index.json 为空（缓存已清），尝试从 users.json 恢复
        if ((!libraryData.songs || libraryData.songs.length === 0) && isDesktop()) {
          try {
            const api = await getDesktopAPIAsync();
            const userData = await api?.userDataLoad?.();
            if (userData && userData.tracks && userData.tracks.length > 0) {
              logger.info('[LibraryLoad] Recovering', userData.tracks.length, 'tracks from ~/.la/users.json');
              const tracks = (userData.tracks as any[]).map(minimalTrackToLibrarySong);
              const cloudTracks = tracks.filter(t => t.source === 'webdav');
              const localTracks = tracks.filter(t => !t.source || t.source === 'local');
              // 同时恢复 settings 到 appStorage/localStorage
              if (userData.settings && Object.keys(userData.settings).length > 0) {
                for (const [key, value] of Object.entries(userData.settings)) {
                  localStorage.setItem(key, value);
                }
                // 异步持久化到 settings.json
                appStorage.replaceAll(userData.settings).catch(() => {});
              } else {
                // users.json 无 settings 时，尝试从主进程 settings.json 恢复
                try {
                  const api = await getDesktopAPIAsync();
                  const mpSettings = await api?.settingsGetAll?.();
                  if (mpSettings && Object.keys(mpSettings).length > 0) {
                    for (const [key, value] of Object.entries(mpSettings)) {
                      localStorage.setItem(key, value);
                    }
                    logger.info('[LibraryLoad] Restored', Object.keys(mpSettings).length, 'settings from settings.json');
                  }
                } catch (e2) {
                  logger.warn('[LibraryLoad] Failed to restore settings from settings.json:', e2);
                }
              }
              // 恢复 playback 状态
              const pbJson = userData.playback?.['_json'];
              if (pbJson) {
                try {
                  const pb = JSON.parse(pbJson);
                  const slotKey = pb.activeSlotId === 'cloud' ? 'cloudSlot' : 'localSlot';
                  const slot = pb[slotKey];
                  if (slot?.volume !== undefined) localStorage.setItem('playback', pbJson);
                  appStorage.setItem('playback', pbJson).catch(() => {});
                } catch {}
              }
              await loadAndRestoreLibrary({
                songs: localTracks,
                ...(cloudTracks.length > 0 ? { cloudSongs: cloudTracks } : {}),
                settings: libraryData.settings,
              } as any);
              isFirstLoadRef.current = false;
              return;
            }
          } catch (e) {
            logger.warn('[LibraryLoad] Failed to recover from users.json:', e);
          }
        }

        await loadAndRestoreLibrary(libraryData);
        isFirstLoadRef.current = false;
      } catch (error) {
        logger.error('[LibraryLoad] Failed to load library:', error);
      }
    };

    loadLibraryFromDisk();
  }, []);

  useEffect(() => {
    if (isFirstLoadRef.current) return;

    const slotsSnapshot = getSlotsSnapshot?.() ?? slots;
    const persistData = getPersistenceData();
    const libraryData = buildLibraryIndexDataForSlots(
      slotsSnapshot.local.tracks,
      slotsSnapshot.cloud.tracks,
      persistData,
      slotsSnapshot.online.tracks,
      slotsSnapshot.playlist.tracks
    );

    logger.debug('[LibraryLoad] Saving library, songs:', libraryData.songs.length, 'cloud songs:', libraryData.cloudSongs?.length || 0);
    libraryStorage.saveLibraryDebounced(libraryData);
    // 并行写入 playback 状态到 settings.json（音量/模式/进度/激活插槽）
    appStorage.setItem('playback', JSON.stringify(persistData)).catch(() => {});
    // 并行写入完整用户数据快照到 ~/.la/users.json（含 tracks + settings + playback）
    if (isDesktop()) {
      const allMinimal = [
        ...buildMinimalTracks(slotsSnapshot.local.tracks),
        ...buildMinimalTracks(slotsSnapshot.cloud.tracks),
        ...buildMinimalTracks(slotsSnapshot.online.tracks),
        ...buildMinimalTracks(slotsSnapshot.playlist.tracks),
      ];
      const allSettings: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) allSettings[key] = localStorage.getItem(key) ?? '';
      }
      getDesktopAPIAsync().then(api => {
        api?.userDataSave?.({
          tracks: allMinimal,
          settings: allSettings,
          playback: { _json: JSON.stringify(persistData) },
        }).catch(() => {});
      }).catch(() => {});
    }
  }, [slots.local.tracks, slots.local.currentTrackIndex, slots.local.currentTime, slots.local.volume, slots.local.playbackMode, slots.cloud.tracks, slots.cloud.currentTrackIndex, slots.cloud.currentTime, slots.cloud.volume, slots.cloud.playbackMode, slots.online.tracks, slots.online.currentTrackIndex, slots.online.currentTime, slots.online.volume, slots.online.playbackMode, slots.playlist.tracks, slots.playlist.currentTrackIndex, slots.playlist.currentTime, slots.playlist.volume, slots.playlist.playbackMode]);

  useEffect(() => {
    if (!isDesktop()) return;

    persistedTimeRef.current = 0;

    const interval = setInterval(() => {
      if (!audioRef.current) return;
      const nowTime = audioRef.current.currentTime || 0;

      if (Math.abs(nowTime - persistedTimeRef.current) >= 5) {
        persistedTimeRef.current = nowTime;
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [persistedTimeRef, audioRef]);

  useEffect(() => {
    const flushCurrentLibrary = async (): Promise<boolean> => {
      try {
        const slotsSnapshot = getSlotsSnapshot?.() ?? slots;
        const persistData = getPersistenceData();
        const libraryData = buildLibraryIndexDataForSlots(
          slotsSnapshot.local.tracks,
          slotsSnapshot.cloud.tracks,
          persistData,
          slotsSnapshot.online.tracks,
          slotsSnapshot.playlist.tracks
        );

        logger.debug('[LibraryLoad] Flushing library before close');
        // Best-effort: settings + userData save 失败不阻塞窗口关闭
        try {
          await appStorage.setItem('playback', JSON.stringify(persistData));
        } catch (e) {
          logger.warn('[LibraryLoad] Failed to flush playback settings:', e);
        }
	        if (isDesktop()) {
	          try {
	            const api = await getDesktopAPIAsync();
	            const allMinimal = [
	              ...buildMinimalTracks(slotsSnapshot.local.tracks),
	              ...buildMinimalTracks(slotsSnapshot.cloud.tracks),
	              ...buildMinimalTracks(slotsSnapshot.online.tracks),
	              ...buildMinimalTracks(slotsSnapshot.playlist.tracks),
	            ];
	            const allSettings: Record<string, string> = {};
	            for (let i = 0; i < localStorage.length; i++) {
	              const key = localStorage.key(i);
	              if (key) allSettings[key] = localStorage.getItem(key) ?? '';
	            }
	            await api?.userDataSave?.({
	              tracks: allMinimal,
	              settings: allSettings,
	              playback: { _json: JSON.stringify(persistData) },
	            });
	          } catch (e) {
	            logger.warn('[LibraryLoad] Failed to flush user data:', e);
	          }
	        }
        // 至少确保 library-index.json 写入
        return libraryStorage.flushPendingSave(libraryData);
      } catch (e) {
        logger.error('[LibraryLoad] Flush failed:', e);
        return false;
      }
    };

    const removeFlushListener = addLibraryFlushListener(flushCurrentLibrary);
    let removeWindowCloseListener: (() => void) | undefined;
    let mounted = true;
    void getDesktopAPIAsync().then(api => {
      if (!mounted) return;
      removeWindowCloseListener = api?.onBeforeWindowClose?.(() => flushCurrentLibrary());
    });

    const handleBeforeUnload = () => {
      void flushCurrentLibrary();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      mounted = false;
      removeWindowCloseListener?.();
      removeFlushListener();
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [slots, getPersistenceData, getSlotsSnapshot]);
}
