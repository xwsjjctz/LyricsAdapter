import { useState, useCallback, useMemo, useRef } from 'react';
import { LibrarySlot, Track, createEmptySlot, PlaybackContext } from '../types';
import { UI } from '../constants/config';
import { logger } from '../services/logger';

type SlotId = 'local' | 'cloud';

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
  localSlot?: SlotPersistenceData;
  cloudSlot?: SlotPersistenceData;
  activeSlotId?: SlotId;
  activeDataSource?: SlotId;
  localPlaybackContext?: PlaybackContext;
  cloudPlaybackContext?: PlaybackContext;
}

export function useLibrarySlots() {
  const [slots, setSlots] = useState<Record<SlotId, LibrarySlot>>({
    local: createEmptySlot('local'),
    cloud: createEmptySlot('cloud'),
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
    setSlots(prev => ({
      ...prev,
      cloud: { ...prev.cloud, tracks },
    }));
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
      activeSlotId,
    };
  }, [slots, activeSlotId]);

  const restoreFromPersistence = useCallback((data: PersistedSlotState, tracksFromDisk: Track[]) => {
    const slotState = data.localSlot || data.cloudSlot
      ? data
      : migrateFromLegacyFormat(data);

    if (slotState.activeSlotId) {
      setActiveSlotId(slotState.activeSlotId);
    }

    setSlots(prev => {
      const localData = slotState.localSlot;
      const cloudData = slotState.cloudSlot;
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
    updateLocalTracks,
    getPersistenceData,
    restoreFromPersistence,
  };
}

function migrateFromLegacyFormat(data: PersistedSlotState): { localSlot: SlotPersistenceData; cloudSlot: SlotPersistenceData; activeSlotId: SlotId } {
  const legacyLocal = data.localPlaybackContext;
  const legacyCloud = data.cloudPlaybackContext;

  const localSlot: SlotPersistenceData = {
    currentTrackIndex: legacyLocal?.trackIndex ?? -1,
    currentTime: legacyLocal?.currentTime ?? 0,
    volume: legacyLocal?.volume ?? UI.DEFAULT_VOLUME,
    playbackMode: legacyLocal?.playbackMode ?? 'order',
    scrollPosition: 0,
    filterType: 'default',
    categorySelection: null,
  };

  const cloudSlot: SlotPersistenceData = {
    currentTrackIndex: legacyCloud?.trackIndex ?? -1,
    currentTime: legacyCloud?.currentTime ?? 0,
    volume: legacyCloud?.volume ?? UI.DEFAULT_VOLUME,
    playbackMode: legacyCloud?.playbackMode ?? 'order',
    scrollPosition: 0,
    filterType: 'default',
    categorySelection: null,
  };

  const activeSlotId = data.activeSlotId || data.activeDataSource || 'local';

  logger.info('[useLibrarySlots] Migrated legacy format to slot format');

  return { localSlot, cloudSlot, activeSlotId };
}
