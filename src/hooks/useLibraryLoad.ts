import { useEffect, useRef } from 'react';
import { Track, LibrarySlot, SlotId } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage } from '../services/libraryStorage';
import type { LibraryIndexData, LibraryIndexSong, LibrarySettings, PlaylistsViewPersistence } from '../services/libraryStorage';
import { metadataCacheService } from '../services/metadataCacheService';
import { buildLibraryIndexDataForSlots, buildMinimalTracks, minimalTrackToLibrarySong, type UserTrackRecord } from '../services/librarySerializer';
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

interface UserDataSnapshot {
  tracks?: unknown[];
  settings?: Record<string, string>;
  playback?: Record<string, string>;
}

const SLOT_IDS: SlotId[] = ['local', 'cloud', 'online', 'playlist'];

function isSlotId(value: unknown): value is SlotId {
  return typeof value === 'string' && SLOT_IDS.includes(value as SlotId);
}

function hasPersistedTracks(libraryData: Partial<LibraryIndexData>): boolean {
  return Boolean(
    libraryData.songs?.length ||
    libraryData.cloudSongs?.length ||
    libraryData.onlineSongs?.length ||
    libraryData.playlistSongs?.length
  );
}

function selectSettingsSource(userData: UserDataSnapshot, settingsFromStore?: Record<string, string>): Record<string, string> {
  return settingsFromStore && Object.keys(settingsFromStore).length > 0
    ? settingsFromStore
    : userData.settings || {};
}

function parsePlaybackSettings(userData: UserDataSnapshot, settingsSource?: Record<string, string>): LibrarySettings {
  const raw = userData.playback?.['_json'] || settingsSource?.['playback'] || userData.settings?.['playback'];
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildSettingsFromUserData(
  userData: UserDataSnapshot,
  fallbackSettings: LibrarySettings,
  settingsFromStore?: Record<string, string>
): LibrarySettings {
  const settingsSource = selectSettingsSource(userData, settingsFromStore);
  return {
    ...fallbackSettings,
    ...parsePlaybackSettings(userData, settingsSource),
  };
}

function getUserTrackRecords(userData: UserDataSnapshot): UserTrackRecord[] {
  return (userData.tracks || []).filter((record): record is UserTrackRecord => {
    return Boolean(record && typeof record === 'object' && typeof (record as UserTrackRecord).id === 'string');
  });
}

function inferSlotId(record: UserTrackRecord): SlotId {
  if (isSlotId(record.slotId)) return record.slotId;
  if (record.source === 'webdav') return 'cloud';
  if (record.source === 'qq' || record.source === 'netease') return 'online';
  return 'local';
}

function collectCachedSongsById(libraryData: Partial<LibraryIndexData>): Map<string, LibraryIndexSong> {
  const cachedSongs = [
    ...(libraryData.songs || []),
    ...(libraryData.cloudSongs || []),
    ...(libraryData.onlineSongs || []),
    ...(libraryData.playlistSongs || []),
  ];
  return new Map(cachedSongs.map(song => [song.id, song]));
}

function mergeUserTrackWithCachedSong(record: UserTrackRecord, cached?: LibraryIndexSong): LibraryIndexSong {
  const userSong = minimalTrackToLibrarySong(record);
  if (!cached) return userSong;

  const merged: LibraryIndexSong = {
    ...cached,
    ...userSong,
    title: cached.title || userSong.title,
    artist: cached.artist || userSong.artist,
    album: cached.album || userSong.album,
    duration: cached.duration || userSong.duration,
  };
  const lyrics = cached.lyrics || userSong.lyrics;
  const syncedLyrics = cached.syncedLyrics || userSong.syncedLyrics;
  const coverUrl = cached.coverUrl || userSong.coverUrl;
  if (lyrics) merged.lyrics = lyrics;
  if (syncedLyrics) merged.syncedLyrics = syncedLyrics;
  if (coverUrl) merged.coverUrl = coverUrl;
  return merged;
}

function buildLibraryDataFromUserData(
  userData: UserDataSnapshot,
  fallbackSettings: LibrarySettings,
  settingsFromStore?: Record<string, string>,
  cachedLibraryData?: Partial<LibraryIndexData>
): LibraryIndexData | null {
  const records = getUserTrackRecords(userData);
  if (records.length === 0) return null;
  const cachedById = collectCachedSongsById(cachedLibraryData || {});

  const bySlot: Record<SlotId, UserTrackRecord[]> = {
    local: [],
    cloud: [],
    online: [],
    playlist: [],
  };

  for (const record of records) {
    bySlot[inferSlotId(record)].push(record);
  }

  const toLibrarySong = (record: UserTrackRecord) => mergeUserTrackWithCachedSong(record, cachedById.get(record.id));
  const cloudSongs = bySlot.cloud.map(toLibrarySong);
  const onlineSongs = bySlot.online.map(toLibrarySong);
  const playlistSongs = bySlot.playlist.map(toLibrarySong);

  return {
    songs: bySlot.local.map(toLibrarySong),
    ...(cloudSongs.length > 0 ? { cloudSongs } : {}),
    ...(onlineSongs.length > 0 ? { onlineSongs } : {}),
    ...(playlistSongs.length > 0 ? { playlistSongs } : {}),
    settings: buildSettingsFromUserData(userData, fallbackSettings, settingsFromStore),
  };
}

async function syncSettingsToAppStorage(settings: Record<string, string>, playbackJson?: string): Promise<void> {
  if (Object.keys(settings).length === 0 && !playbackJson) return;

  if (Object.keys(settings).length > 0) {
    for (const [key, value] of Object.entries(settings)) {
      localStorage.setItem(key, value);
    }
    await appStorage.setMany(settings);
  }

  if (playbackJson) {
    localStorage.setItem('playback', playbackJson);
    await appStorage.setItem('playback', playbackJson);
  }
}

async function syncUserSettingsToAppStorage(
  userData: UserDataSnapshot,
  settingsFromStore?: Record<string, string>
): Promise<void> {
  const settings = selectSettingsSource(userData, settingsFromStore);
  const playbackJson = userData.playback?.['_json'] || settings['playback'] || userData.settings?.['playback'];
  await syncSettingsToAppStorage(settings, playbackJson);
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
        let restoredLibraryData = libraryData;

        if (isDesktop()) {
          try {
            const api = await getDesktopAPIAsync();
            const mainSettings = await api?.settingsGetAll?.() ?? {};
            const userData = await api?.userDataLoad?.();
            if (userData) {
              try {
                await syncUserSettingsToAppStorage(userData, mainSettings);
              } catch (e) {
                logger.warn('[LibraryLoad] Failed to sync ~/.la user settings:', e);
              }

              const rebuiltLibrary = buildLibraryDataFromUserData(userData, libraryData.settings || {}, mainSettings, libraryData);
              if (rebuiltLibrary && hasPersistedTracks(rebuiltLibrary)) {
                logger.info('[LibraryLoad] Loading user library from ~/.la/users.json, tracks:', getUserTrackRecords(userData).length);
                restoredLibraryData = rebuiltLibrary;
                const saved = await libraryStorage.saveLibrary(rebuiltLibrary);
                if (!saved) {
                  logger.warn('[LibraryLoad] Failed to rebuild library-index cache from user data');
                }
              } else if (hasPersistedTracks(libraryData)) {
                restoredLibraryData = {
                  ...libraryData,
                  settings: buildSettingsFromUserData(userData, libraryData.settings || {}, mainSettings),
                };
              }
            } else {
              try {
                if (Object.keys(mainSettings).length > 0) {
                  await syncSettingsToAppStorage(mainSettings);
                  logger.info('[LibraryLoad] Restored', Object.keys(mainSettings).length, 'settings from settings.json');
                }
              } catch (e2) {
                logger.warn('[LibraryLoad] Failed to restore settings from settings.json:', e2);
              }
            }
          } catch (e) {
            logger.warn('[LibraryLoad] Failed to load ~/.la user data:', e);
          }
        }

        await loadAndRestoreLibrary(restoredLibraryData);
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
        ...buildMinimalTracks(slotsSnapshot.local.tracks, 'local'),
        ...buildMinimalTracks(slotsSnapshot.cloud.tracks, 'cloud'),
        ...buildMinimalTracks(slotsSnapshot.online.tracks, 'online'),
        ...buildMinimalTracks(slotsSnapshot.playlist.tracks, 'playlist'),
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
              ...buildMinimalTracks(slotsSnapshot.local.tracks, 'local'),
              ...buildMinimalTracks(slotsSnapshot.cloud.tracks, 'cloud'),
              ...buildMinimalTracks(slotsSnapshot.online.tracks, 'online'),
              ...buildMinimalTracks(slotsSnapshot.playlist.tracks, 'playlist'),
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
