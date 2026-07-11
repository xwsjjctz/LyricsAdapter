import { useEffect, useRef } from 'react';
import { Track, LibrarySlot, SlotId } from '../types';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { libraryStorage } from '../services/libraryStorage';
import type { LibraryIndexData, LibraryIndexSong, LibrarySettings } from '../services/libraryStorage';
import { metadataCacheService } from '../services/metadataCacheService';
import { buildLibraryIndexDataForSlots, buildMinimalTracks, minimalTrackToLibrarySong, type UserTrackRecord } from '../services/librarySerializer';
import { logger } from '../services/logger';
import { addLibraryFlushListener } from '../services/libraryFlushEvent';
import { sanitizePersistedCoverUrl } from '../services/coverUrl';
import { appStorage } from '../services/appStorage';
import { webdavClient } from '../services/webdavClient';
import { settingsManager } from '../services/settingsManager';
import { cookieManager, neteaseCookieManager, syncOnlineCookiesToMain } from '../services/cookieManager';

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
  onLibrarySettingsRestored?: (settings: { activeSlotId?: SlotId; currentTime?: number }) => void;
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

/**
 * 将缓存层（library-index.json）的歌曲按 slot 提取为最小化用户记录，
 * 用于在 ~/.la/users.json 尚未被填充时把现有库"播种"进用户数据。
 * 这是"清缓存后可从用户数据重建"目标的兜底：只要 cache 还在，
 * 首次启动就把归属信息写入 users.json，之后清掉 cache 也能恢复。
 */
function songsToMinimalRecords(songs: LibraryIndexSong[] | undefined, slotId: SlotId): UserTrackRecord[] {
  if (!songs || songs.length === 0) return [];
  return songs.map(song => ({
    id: song.id,
    slotId,
    ...(song.filePath ? { filePath: song.filePath } : undefined),
    ...(song.webdavPath ? { webdavPath: song.webdavPath } : undefined),
    ...(song.fileName ? { fileName: song.fileName } : undefined),
    ...(song.fileSize ? { fileSize: song.fileSize } : undefined),
    ...(song.lastModified ? { lastModified: song.lastModified } : undefined),
    ...(song.source ? { source: song.source } : undefined),
    ...(song.addedAt ? { addedAt: song.addedAt } : undefined),
    ...(song.playCount != null ? { playCount: song.playCount } : undefined),
    ...(song.lastPlayed !== undefined ? { lastPlayed: song.lastPlayed } : undefined),
    ...(song.songmid ? { songmid: song.songmid } : undefined),
    ...(song.available !== undefined ? { available: song.available } : undefined),
  }));
}

function collectLocalStorageSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) out[key] = localStorage.getItem(key) ?? '';
  }
  return out;
}

async function seedUserDataFromCache(
  libraryData: LibraryIndexData,
  persistData: LibrarySettings
): Promise<void> {
  try {
    const api = await getDesktopAPIAsync();
    if (!api?.userDataSave) return;
    const tracks: UserTrackRecord[] = [
      ...songsToMinimalRecords(libraryData.songs, 'local'),
      ...songsToMinimalRecords(libraryData.cloudSongs, 'cloud'),
      ...songsToMinimalRecords(libraryData.onlineSongs, 'online'),
      ...songsToMinimalRecords(libraryData.playlistSongs, 'playlist'),
    ];
    if (tracks.length === 0) return;
    await api.userDataSave({
      tracks,
      settings: collectLocalStorageSnapshot(),
      playback: { _json: JSON.stringify(persistData) },
    });
    logger.info('[LibraryLoad] Seeded ~/.la/users.json from cache, tracks:', tracks.length);
  } catch (e) {
    logger.warn('[LibraryLoad] Failed to seed ~/.la/users.json from cache:', e);
  }
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

    metadataCacheService.initialize().then(async () => {
      // 第 1 步：从元数据缓存充实本地曲目（清缓存前已有的元数据可直接恢复）
      let enrichedCount = 0;
      const localFilePathTracks = loadedTracks.filter(t => t.filePath);
      if (localFilePathTracks.length > 0) {
        setLocalTracks(prev => {
          let changed = false;
          const next = prev.map(track => {
            if (!track.filePath) return track;
            const cached = metadataCacheService.get(track.id);
            if (!cached) return track;

            const fallbackTitle = track.fileName?.replace(/\.[^/.]+$/, '') || '';
            const hasBetterInfo =
              (track.title === fallbackTitle && !!cached.title) ||
              (track.artist === 'Unknown Artist' && !!cached.artist) ||
              (track.album === 'Unknown Album' && !!cached.album) ||
              (track.duration === 0 && !!cached.duration);

            if (!hasBetterInfo) return track;

            changed = true;
            enrichedCount++;
            return {
              ...track,
              title: cached.title || track.title,
              artist: cached.artist || track.artist,
              album: cached.album || track.album,
              duration: cached.duration || track.duration,
              lyrics: cached.lyrics || track.lyrics,
              syncedLyrics: cached.syncedLyrics || track.syncedLyrics,
            };
          });
          return changed ? next : prev;
        });
      }

      // 第 2 步：对缓存不存在的本地文件曲目，从音频文件重新解析元数据
      const api = await getDesktopAPIAsync();
      if (api) {
        const tracksToParse = loadedTracks.filter(t => {
          if (!t.filePath) return false;
          const cached = metadataCacheService.get(t.id);
          if (!cached) return true;
          // 缓存虽有但核心字段为空仍需解析
          return !cached.title || !cached.artist || !cached.duration;
        });

        if (tracksToParse.length > 0) {
          logger.info('[LibraryLoad] Re-parsing metadata for', tracksToParse.length, 'tracks (cache miss)');

          // 先将所有路径加入主进程 allowlist，避免 readFile 被拦截。
          // 注意：api 必须是 ElectronAdapter（其 ipc getter 透传 window.electron.ipc），
          // 否则 allowlist 不会建立，readAudio/read-file 全部被 canReadAudioPath 拒绝。
          const ipc = api.ipc;
          if (ipc?.file?.allowAudioPath) {
            let allowFailures = 0;
            for (const track of tracksToParse) {
              try {
                await ipc.file.allowAudioPath(track.filePath!);
              } catch (e) {
                allowFailures++;
                // 单个路径放行失败不阻塞整体
              }
            }
            if (allowFailures > 0) {
              logger.warn('[LibraryLoad] allowAudioPath failed for', allowFailures, '/', tracksToParse.length, 'paths');
            }
          } else {
            // 没有 typed IPC（非 Electron 或 adapter 未透传 ipc）→ re-parse 必然失败，
            // 显式告警以便发现，而不是静默 "complete" 但 0 首恢复。
            logger.warn('[LibraryLoad] typed IPC allowAudioPath unavailable; re-parse will likely fail to read files');
          }

          // 逐个解析并更新（批量 3 个并发避免阻塞 UI）
          const BATCH_SIZE = 3;
          let parseOk = 0;
          let parseFail = 0;
          for (let i = 0; i < tracksToParse.length; i += BATCH_SIZE) {
            const batch = tracksToParse.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(
              batch.map(track =>
                api!.parseAudioMetadata(track.filePath!).then(result => {
                  if (result.success && result.metadata) {
                    const md = result.metadata as {
                      title: string;
                      artist: string;
                      album: string;
                      duration: number;
                      lyrics?: string;
                      syncedLyrics?: { time: number; text: string }[];
                      coverData?: string;
                      coverMime?: string;
                      fileSize?: number;
                    };
                    // 保存到元数据缓存
                    metadataCacheService.set(track.id, {
                      title: md.title || '',
                      artist: md.artist || '',
                      album: md.album || '',
                      duration: md.duration || 0,
                      lyrics: md.lyrics || '',
                      syncedLyrics: md.syncedLyrics,
                      fileName: track.fileName || '',
                      fileSize: md.fileSize || track.fileSize || 0,
                      lastModified: track.lastModified || 0,
                    });
                    return { track, md };
                  }
                  return null;
                })
              )
            );

            // 将解析结果更新到 React 状态
            const updates: Array<{ id: string; title: string; artist: string; album: string; duration: number; lyrics: string; syncedLyrics?: { time: number; text: string }[]; coverData?: string; coverMime?: string }> = [];
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value) {
                parseOk++;
                const { track, md } = result.value;
                const entry: {
                  id: string; title: string; artist: string; album: string; duration: number; lyrics: string;
                  syncedLyrics?: { time: number; text: string }[]; coverData?: string; coverMime?: string;
                } = { id: track.id, title: md.title || '', artist: md.artist || '', album: md.album || '', duration: md.duration || 0, lyrics: md.lyrics || '' };
                if (md.syncedLyrics) entry.syncedLyrics = md.syncedLyrics;
                if (md.coverData) entry.coverData = md.coverData;
                if (md.coverMime) entry.coverMime = md.coverMime;
                updates.push(entry);
              } else {
                parseFail++;
                if (result.status === 'rejected') {
                  logger.warn('[LibraryLoad] parseAudioMetadata rejected for a track:', result.reason);
                }
              }
            }

            if (updates.length > 0) {
              setLocalTracks(prev => {
                let changed = false;
                const next = prev.map(track => {
                  const update = updates.find(u => u.id === track.id);
                  if (!update) return track;
                  changed = true;
                  return {
                    ...track,
                    title: update.title || track.title,
                    artist: update.artist || track.artist,
                    album: update.album || track.album,
                    duration: update.duration || track.duration,
                    lyrics: update.lyrics || track.lyrics,
                    syncedLyrics: update.syncedLyrics || track.syncedLyrics,
                  };
                });
                return changed ? next : prev;
              });

              // 异步保存封面缩略图（不阻塞元数据更新）
              for (const update of updates) {
                if (update.coverData && update.coverMime && api.saveCoverThumbnail) {
                  api.saveCoverThumbnail({
                    id: update.id,
                    data: update.coverData,
                    mime: update.coverMime,
                  }).then(result => {
                    if (result.success && result.coverUrl) {
                      // 封面保存成功后把 coverUrl 更新到 track 状态
                      setLocalTracks(prev => {
                        let changed = false;
                        const next = prev.map(track => {
                          if (track.id !== update.id || track.coverUrl) return track;
                          changed = true;
                          return { ...track, coverUrl: result.coverUrl };
                        });
                        return changed ? next : prev;
                      });
                    }
                  }).catch(err => {
                    logger.warn('[LibraryLoad] Failed to save cover thumbnail for', update.id, err);
                  });
                }
              }
            }
          }

          logger.info('[LibraryLoad] Metadata re-parse complete:', parseOk, 'succeeded /', parseFail, 'failed of', tracksToParse.length, 'tracks');
        }
      }

      if (enrichedCount > 0) {
        logger.info('[LibraryLoad] Enriched', enrichedCount, 'tracks from metadata cache');
      }
    }).catch(err => {
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

    const restoredSettings: { activeSlotId?: SlotId; currentTime?: number } = {
      activeSlotId: activeSource,
      currentTime: activeSlotState?.currentTime ?? 0,
    };
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

              // 兜底播种：users.json 的 tracks 为空但 cache 有内容时，
              // 把 cache 的归属信息写入 users.json，确保清缓存后可重建。
              if (getUserTrackRecords(userData).length === 0 && hasPersistedTracks(libraryData)) {
                await seedUserDataFromCache(libraryData, libraryData.settings || {});
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

            // settings.json 已灌入 localStorage/appStorage，通知在模块导入时
            // 就读取（早于 init 完成）的消费者重新加载，使清空 userData 后
            // WebDAV 配置、偏好设置、登录 cookie 等能自动恢复生效，无需重启或重填。
            try {
              webdavClient.reloadConfig();
              settingsManager.reload();
              // cookieManager 构造期 loadFromStorage 同样可能读到空，需重新加载
              // 后再把 cookie 同步到主进程 stream:// 代理。
              cookieManager.reload();
              neteaseCookieManager.reload();
              void syncOnlineCookiesToMain();
            } catch (e) {
              logger.warn('[LibraryLoad] Failed to notify settings consumers to reload:', e);
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
    // 注意：currentTime 不在本依赖数组中 —— 播放期间 timeupdate（~250ms/次）
    // 引起的进度变化由下方 savePlaybackThrottled 独立节流（5s）落盘，避免每秒
    // 4 次同步磁盘写。此处落盘的 persistData 仍含最新 currentTime（取值时是最新的），
    // 只是进度的高频变化不再驱动本 effect。
  }, [slots.local.tracks, slots.local.currentTrackIndex, slots.local.volume, slots.local.playbackMode, slots.cloud.tracks, slots.cloud.currentTrackIndex, slots.cloud.volume, slots.cloud.playbackMode, slots.online.tracks, slots.online.currentTrackIndex, slots.online.volume, slots.online.playbackMode, slots.playlist.tracks, slots.playlist.currentTrackIndex, slots.playlist.volume, slots.playlist.playbackMode]);

  /**
   * 播放进度节流落盘。
   *
   * <audio> 的 timeupdate 约 250ms 触发一次，若直接驱动写盘会是每秒 ~4 次同步
   * 磁盘写（settings.json + users.json）。此处用 leading + trailing 节流：每 5s
   * 最多落盘一次。退出/切歌由下方 flushCurrentLibrary 兜底，最坏丢失 ≤5s 进度
   *（参考 Apple Music / Spotify）。
   *
   * 注意：timer 的清理放在独立的卸载 effect 中（见本文件末尾），不能放在本 effect
   * 的 return 里 —— 否则每次 currentTime 变化都会清掉尚未触发的 trailing timer，
   * 导致 trailing 永远执行不到。
   */
  const playbackSaveLastRef = useRef(0);
  const playbackSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isFirstLoadRef.current) return;
    const THROTTLE_MS = 5000;
    const now = Date.now();
    const elapsed = now - playbackSaveLastRef.current;

    const doSave = () => {
      playbackSaveLastRef.current = Date.now();
      const persistData = getPersistenceData();
      appStorage.setItem('playback', JSON.stringify(persistData)).catch(() => {});
    };

    if (elapsed >= THROTTLE_MS) {
      // 距上次已超过 5s，立即落盘（leading）
      doSave();
    } else if (!playbackSaveTimerRef.current) {
      // 否则排一个 trailing，保证最后一次进度变化也能落盘（避免快进后停住不存）
      playbackSaveTimerRef.current = setTimeout(() => {
        playbackSaveTimerRef.current = null;
        doSave();
      }, THROTTLE_MS - elapsed);
    }
  }, [
    slots.local.currentTime, slots.cloud.currentTime,
    slots.online.currentTime, slots.playlist.currentTime,
    // getPersistenceData / appStorage 为稳定引用，不计入依赖
  ]);

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

  // 组件卸载时清理进度节流的 trailing timer（见上方 playbackSaveTimerRef 注释）
  useEffect(() => {
    return () => {
      if (playbackSaveTimerRef.current) {
        clearTimeout(playbackSaveTimerRef.current);
        playbackSaveTimerRef.current = null;
      }
    };
  }, []);
}
