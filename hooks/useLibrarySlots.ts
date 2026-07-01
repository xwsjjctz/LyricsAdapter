import { useState, useCallback } from 'react';
import { LibrarySlot, Track, SlotId, createEmptySlot, PlaybackContext } from '../types';
import { logger } from '../services/logger';

/** LRU cap for the online-playback list (most-recent at the head). */
const ONLINE_MAX_TRACKS = 50;

interface SlotPersistenceData {
  currentTrackIndex: number;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  scrollPosition: number;
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
}

interface PersistedSlotState {
  localSlot?: SlotPersistenceData | Partial<SlotPersistenceData>;
  cloudSlot?: SlotPersistenceData | Partial<SlotPersistenceData>;
  onlineSlot?: SlotPersistenceData | Partial<SlotPersistenceData>;
  activeSlotId?: SlotId;
  activeDataSource?: SlotId;
  localPlaybackContext?: PlaybackContext;
  cloudPlaybackContext?: PlaybackContext;
}

/**
 * 云端排序键：lastModified（PROPFIND 的 getlastmodified，即「上传时间」，存为 number 毫秒）。
 * 缺失/非法视为 0（最旧，置顶）。以单一确定性键排序，彻底消除上传版/扫描版 id 分裂导致的跳位。
 */
function cloudSortKey(t: Track): number {
  const v = t.lastModified;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** 云端曲目按上传时间升序排序：最新上传的在列表最底部。 */
function sortCloudTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => cloudSortKey(a) - cloudSortKey(b));
}

/**
 * 排序后把 currentTrackIndex 重新指向原正在播放的曲目。
 * 按 id 匹配；webdav 额外按 fileName 兜底（上传版/扫描版 id 不同但同一文件）。
 * 找不到（已被删除）则置 -1。
 */
function reindexCurrent(cloud: LibrarySlot, newTracks: Track[]): number {
  const cur = cloud.currentTrackIndex;
  if (cur < 0 || cur >= cloud.tracks.length) return cur;
  const playing = cloud.tracks[cur]!;
  const idx = newTracks.findIndex(t =>
    t.id === playing.id ||
    (!!playing.fileName && t.source === 'webdav' && t.fileName === playing.fileName)
  );
  return idx >= 0 ? idx : -1;
}

export function useLibrarySlots() {
  const [slots, setSlots] = useState<Record<SlotId, LibrarySlot>>({
    local: createEmptySlot('local'),
    cloud: createEmptySlot('cloud'),
    online: createEmptySlot('online'),
  });
  const [activeSlotId, setActiveSlotId] = useState<SlotId>('local');

  const activeSlot = slots[activeSlotId];
  const activeTracks = activeSlot.tracks;
  const activeTrackIndex = activeSlot.currentTrackIndex;

  const switchTo = useCallback((slotId: SlotId) => {
    setActiveSlotId(slotId);
  }, []);

  const updateSlot = useCallback((slotId: SlotId, updater: (slot: LibrarySlot) => LibrarySlot) => {
    setSlots(prev => ({
      ...prev,
      [slotId]: updater(prev[slotId]),
    }));
  }, []);

  const setActiveTrackIndex = useCallback((index: number | ((prev: number) => number)) => {
    setSlots(prev => {
      const slot = prev[activeSlotId];
      const newIndex = typeof index === 'function' ? index(slot.currentTrackIndex) : index;
      if (newIndex === slot.currentTrackIndex) return prev;
      return {
        ...prev,
        [activeSlotId]: { ...slot, currentTrackIndex: newIndex },
      };
    });
  }, [activeSlotId]);

  const setActiveTracks = useCallback((updater: Track[] | ((prev: Track[]) => Track[])) => {
    setSlots(prev => {
      const slot = prev[activeSlotId];
      const newTracks = typeof updater === 'function' ? updater(slot.tracks) : updater;
      return {
        ...prev,
        [activeSlotId]: { ...slot, tracks: newTracks },
      };
    });
  }, [activeSlotId]);

  const setActiveCurrentTime = useCallback((time: number) => {
    setSlots(prev => ({
      ...prev,
      [activeSlotId]: { ...prev[activeSlotId], currentTime: time },
    }));
  }, [activeSlotId]);

  const setActiveVolume = useCallback((volume: number) => {
    setSlots(prev => ({
      ...prev,
      [activeSlotId]: { ...prev[activeSlotId], volume },
    }));
  }, [activeSlotId]);

  const setActivePlaybackMode = useCallback((mode: 'order' | 'shuffle' | 'repeat-one' | ((prev: 'order' | 'shuffle' | 'repeat-one') => 'order' | 'shuffle' | 'repeat-one')) => {
    setSlots(prev => {
      const slot = prev[activeSlotId];
      const newMode = typeof mode === 'function' ? mode(slot.playbackMode) : mode;
      return {
        ...prev,
        [activeSlotId]: { ...slot, playbackMode: newMode },
      };
    });
  }, [activeSlotId]);

  const setActiveScrollPosition = useCallback((position: number) => {
    setSlots(prev => ({
      ...prev,
      [activeSlotId]: { ...prev[activeSlotId], scrollPosition: position },
    }));
  }, [activeSlotId]);

  const setActiveFilterType = useCallback((filterType: 'default' | 'album' | 'artist') => {
    setSlots(prev => ({
      ...prev,
      [activeSlotId]: { ...prev[activeSlotId], filterType },
    }));
  }, [activeSlotId]);

  const setActiveCategorySelection = useCallback((categorySelection: string | null) => {
    setSlots(prev => ({
      ...prev,
      [activeSlotId]: { ...prev[activeSlotId], categorySelection },
    }));
  }, [activeSlotId]);

  const loadCloudTracks = useCallback((tracks: Track[]) => {
    setSlots(prev => {
      const cloud = prev.cloud;

      // incoming（扫描结果）是云端成员基准。prev 中被同 id 或同名扫描版覆盖的剔除；
      // 但保留 incoming 未命中的 prev 独有项（如刚上传、PROPFIND 尚未返回的竞态，避免被误删）。
      // incoming 为空（清缓存 / 服务器无文件）时直接清空，不再保留 prev。
      const incomingIds = new Set(tracks.map(t => t.id));
      const incomingNames = new Set(
        tracks.filter(t => t.source === 'webdav' && t.fileName).map(t => t.fileName!)
      );
      const keptFromPrev = tracks.length > 0 ? cloud.tracks.filter(t => {
        if (incomingIds.has(t.id)) return false; // 同 id：用扫描版
        if (t.source === 'webdav' && t.fileName && incomingNames.has(t.fileName)) return false; // 同名：用扫描版（兼容上传/扫描 id 分裂）
        return true; // incoming 没有 → prev 独有，保留
      }) : [];

      // 按上传时间（lastModified）升序排序：最新上传的在最底部。
      const sorted = sortCloudTracks([...tracks, ...keptFromPrev]);

      return {
        ...prev,
        cloud: { ...cloud, tracks: sorted, currentTrackIndex: reindexCurrent(cloud, sorted) },
      };
    });
  }, []);

  const mergeCloudTracks = useCallback((added: Track[], removedIds: string[], updated: Track[]) => {
    setSlots(prev => {
      const cloud = prev.cloud;
      const removedSet = new Set(removedIds);
      const updatedMap = new Map(updated.map(t => [t.id, t]));
      const currentPlayingId = cloud.currentTrackIndex >= 0 && cloud.currentTrackIndex < cloud.tracks.length
        ? cloud.tracks[cloud.currentTrackIndex]!.id
        : null;

      const filtered = cloud.tracks.filter(t => {
        if (!removedSet.has(t.id)) return true;
        if (t.id === currentPlayingId) return true;
        return false;
      }).map(t => {
        if (removedSet.has(t.id) && t.id === currentPlayingId) {
          return { ...t, available: false };
        }
        if (updatedMap.has(t.id)) {
          return updatedMap.get(t.id)!;
        }
        return t;
      });

      const existingIds = new Set(filtered.map(t => t.id));

      // webdav 同名去重（修复刷新重复追加）：
      // 上传构造的曲目 id = webdav-/<fileName>；扫描构造的 id = webdav-<PROPFIND path>。
      // 当服务器返回路径型 href（不含 host）时，path 含 baseSegment（如 /dav/Song.mp3），
      // 与上传用的 /<fileName> 不同 → 两条 id 不一致 → 精确去重失败 → 同一首被当新曲追加（重复）。
      // WebDAV 根目录文件名唯一，故按 fileName 把「扫描版」替换掉「上传版」，采用 canonical id/path/元数据，
      // 消除重复。顺序不再依赖此处（由下方 sortCloudTracks 按上传时间统一排序）。
      const webdavNameIndex = new Map<string, number>();
      filtered.forEach((t, i) => {
        if (t.source === 'webdav' && t.fileName) webdavNameIndex.set(t.fileName, i);
      });
      const replacements = new Map<number, Track>(); // filtered 下标 → 用以替换的扫描版
      const newAdded: Track[] = [];
      const seenIds = new Set(existingIds);
      for (const t of added) {
        if (seenIds.has(t.id)) continue; // 精确命中：已在列表
        const sameNameIdx = t.source === 'webdav' && t.fileName ? webdavNameIndex.get(t.fileName) : undefined;
        if (sameNameIdx !== undefined && !replacements.has(sameNameIdx)) {
          replacements.set(sameNameIdx, t); // 用扫描版取代上传版（去重）
          seenIds.add(t.id);
          continue;
        }
        newAdded.push(t);
      }
      const merged = filtered.map((t, i) => replacements.get(i) ?? t);

      // 按上传时间（lastModified）升序排序：最新上传的在最底部。
      const sorted = sortCloudTracks([...merged, ...newAdded]);

      return {
        ...prev,
        cloud: { ...cloud, tracks: sorted, currentTrackIndex: reindexCurrent(cloud, sorted) },
      };
    });
  }, []);

  const updateLocalTracks = useCallback((updater: Track[] | ((prev: Track[]) => Track[])) => {
    setSlots(prev => {
      const newTracks = typeof updater === 'function' ? updater(prev.local.tracks) : updater;
      return {
        ...prev,
        local: { ...prev.local, tracks: newTracks },
      };
    });
  }, []);

  /**
   * Push a streamed third-party track into the online slot — most-recent first,
   * de-duped by id, capped at ONLINE_MAX_TRACKS (LRU eviction from the tail).
   * The currently-playing track is never evicted. Does not change currentTrackIndex.
   */
  const addOnlineTrack = useCallback((track: Track) => {
    setSlots(prev => {
      const online = prev.online;
      // De-dup by id, push to head (most-recent first), cap via LRU from the tail.
      const filtered = online.tracks.filter(t => t.id !== track.id);
      const next = [track, ...filtered].slice(0, ONLINE_MAX_TRACKS);
      return { ...prev, online: { ...online, tracks: next } };
    });
  }, []);

  /** In-place update of online tracks (e.g. metadata enrichment) — preserves order + index. */
  const updateOnlineTracks = useCallback((updater: Track[] | ((prev: Track[]) => Track[])) => {
    setSlots(prev => {
      const newTracks = typeof updater === 'function' ? updater(prev.online.tracks) : updater;
      return {
        ...prev,
        online: { ...prev.online, tracks: newTracks },
      };
    });
  }, []);

  /** Replace the entire online track list (used on library restore from disk). */
  const loadOnlineTracks = useCallback((tracks: Track[]) => {
    setSlots(prev => ({
      ...prev,
      online: { ...prev.online, tracks },
    }));
  }, []);

  // 原地更新 cloud tracks（不做扫描合并/重排/去重），用于不改变列表顺序的细粒度更新
  // （如 clear cache 后清空失效 coverUrl）。顺序与 currentTrackIndex 均保持不变。
  const updateCloudTracks = useCallback((updater: Track[] | ((prev: Track[]) => Track[])) => {
    setSlots(prev => {
      const newTracks = typeof updater === 'function' ? updater(prev.cloud.tracks) : updater;
      return {
        ...prev,
        cloud: { ...prev.cloud, tracks: newTracks },
      };
    });
  }, []);

  const getPersistenceData = useCallback(() => {
    const extractSlotData = (slot: LibrarySlot): SlotPersistenceData => ({
      currentTrackIndex: slot.currentTrackIndex,
      currentTime: slot.currentTime,
      volume: slot.volume,
      playbackMode: slot.playbackMode,
      scrollPosition: slot.scrollPosition,
      filterType: slot.filterType,
      categorySelection: slot.categorySelection,
    });
    return {
      localSlot: extractSlotData(slots.local),
      cloudSlot: extractSlotData(slots.cloud),
      onlineSlot: extractSlotData(slots.online),
      activeSlotId,
    };
  }, [slots, activeSlotId]);

  const restoreFromPersistence = useCallback((data: PersistedSlotState, tracksFromDisk: Track[], onlineTracks?: Track[]) => {
    const slotState = data.localSlot || data.cloudSlot || data.onlineSlot
      ? data
      : migrateFromLegacyFormat(data);

    if (slotState.activeSlotId) {
      setActiveSlotId(slotState.activeSlotId);
    }

    setSlots(prev => {
      const localData = slotState.localSlot;
      const cloudData = slotState.cloudSlot;
      const onlineData = slotState.onlineSlot;
      return {
        local: {
          ...prev.local,
          tracks: tracksFromDisk,
          currentTrackIndex: localData?.currentTrackIndex ?? prev.local.currentTrackIndex,
          currentTime: localData?.currentTime ?? prev.local.currentTime,
          volume: localData?.volume ?? prev.local.volume,
          playbackMode: localData?.playbackMode ?? prev.local.playbackMode,
          scrollPosition: localData?.scrollPosition ?? prev.local.scrollPosition,
          filterType: localData?.filterType ?? prev.local.filterType,
          categorySelection: localData?.categorySelection ?? prev.local.categorySelection,
        },
        cloud: {
          ...prev.cloud,
          currentTrackIndex: cloudData?.currentTrackIndex ?? prev.cloud.currentTrackIndex,
          currentTime: cloudData?.currentTime ?? prev.cloud.currentTime,
          volume: cloudData?.volume ?? prev.cloud.volume,
          playbackMode: cloudData?.playbackMode ?? prev.cloud.playbackMode,
          scrollPosition: cloudData?.scrollPosition ?? prev.cloud.scrollPosition,
          filterType: cloudData?.filterType ?? prev.cloud.filterType,
          categorySelection: cloudData?.categorySelection ?? prev.cloud.categorySelection,
        },
        online: {
          ...prev.online,
          tracks: onlineTracks ?? prev.online.tracks,
          currentTrackIndex: onlineData?.currentTrackIndex ?? prev.online.currentTrackIndex,
          currentTime: onlineData?.currentTime ?? prev.online.currentTime,
          volume: onlineData?.volume ?? prev.online.volume,
          playbackMode: onlineData?.playbackMode ?? prev.online.playbackMode,
          scrollPosition: onlineData?.scrollPosition ?? prev.online.scrollPosition,
          filterType: onlineData?.filterType ?? prev.online.filterType,
          categorySelection: onlineData?.categorySelection ?? prev.online.categorySelection,
        },
      };
    });
  }, []);

  return {
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
    setActiveVolume,
    setActivePlaybackMode,
    setActiveScrollPosition,
    setActiveFilterType,
    setActiveCategorySelection,
    loadCloudTracks,
    mergeCloudTracks,
    updateCloudTracks,
    updateLocalTracks,
    addOnlineTrack,
    updateOnlineTracks,
    loadOnlineTracks,
    getPersistenceData,
    restoreFromPersistence,
  };
}

function migrateFromLegacyFormat(data: PersistedSlotState): { localSlot: Partial<SlotPersistenceData>; cloudSlot: Partial<SlotPersistenceData>; onlineSlot?: Partial<SlotPersistenceData>; activeSlotId: SlotId } {
  const legacyLocal = data.localPlaybackContext;
  const legacyCloud = data.cloudPlaybackContext;
  const anyData = data as any;

  const localSlot: Partial<SlotPersistenceData> = {};
  const cloudSlot: Partial<SlotPersistenceData> = {};

  if (legacyLocal) {
    localSlot.currentTrackIndex = legacyLocal.trackIndex;
    localSlot.currentTime = legacyLocal.currentTime;
    localSlot.volume = legacyLocal.volume;
    localSlot.playbackMode = legacyLocal.playbackMode;
  } else {
    // 从旧格式顶层字段迁移到 localSlot
    if (anyData.currentTrackIndex !== undefined) localSlot.currentTrackIndex = anyData.currentTrackIndex;
    if (anyData.currentTime !== undefined) localSlot.currentTime = anyData.currentTime;
    if (anyData.volume !== undefined) localSlot.volume = anyData.volume;
    if (anyData.playbackMode !== undefined) localSlot.playbackMode = anyData.playbackMode;
  }

  if (legacyCloud) {
    cloudSlot.currentTrackIndex = legacyCloud.trackIndex;
    cloudSlot.currentTime = legacyCloud.currentTime;
    cloudSlot.volume = legacyCloud.volume;
    cloudSlot.playbackMode = legacyCloud.playbackMode;
  }

  const activeSlotId = data.activeSlotId || data.activeDataSource || anyData.libraryDataSource || 'local';

  logger.info('[useLibrarySlots] Migrated legacy format to slot format');

  return { localSlot, cloudSlot, activeSlotId };
}
