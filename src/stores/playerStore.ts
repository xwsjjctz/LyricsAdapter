import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../types';
import { useBlobUrls } from '../hooks/useBlobUrls';
import { usePlayback } from '../hooks/usePlayback';
import type { LibrarySlotId } from './libraryStore';

interface PlayerStoreOptions {
  activeTracks: Track[];
  activeTrackIndex: number;
  activeSlotId: LibrarySlotId;
  setActiveTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  setActiveTrackIndex: (index: number | ((prev: number) => number)) => void;
  setActiveCurrentTime: (time: number) => void;
  updateSlot: (slotId: LibrarySlotId, updater: (slot: any) => any) => void;
  onTrackSwitch: () => void;
}

export function usePlayerStore({
  activeTracks,
  activeTrackIndex,
  activeSlotId,
  setActiveTracks,
  setActiveTrackIndex,
  setActiveCurrentTime,
  updateSlot,
  onTrackSwitch,
}: PlayerStoreOptions) {
  const [restoreTime, setRestoreTime] = useState(0);
  const { activeBlobUrlsRef, createTrackedBlobUrl, revokeBlobUrl } = useBlobUrls();
  const playback = usePlayback({
    tracks: activeTracks,
    setTracks: setActiveTracks,
    currentTrackIndex: activeTrackIndex,
    setCurrentTrackIndex: setActiveTrackIndex,
    revokeBlobUrl,
    onTrackSwitch,
    initialCurrentTime: restoreTime,
  });
  const prevSlotIdRef = useRef(activeSlotId);

  useEffect(() => {
    if (activeSlotId !== prevSlotIdRef.current) {
      prevSlotIdRef.current = activeSlotId;
      return;
    }
    if (playback.currentTime > 0) {
      setActiveCurrentTime(playback.currentTime);
    }
  }, [playback.currentTime, setActiveCurrentTime, activeSlotId]);

  useEffect(() => {
    updateSlot(activeSlotId, slot => slot.volume !== playback.volume ? { ...slot, volume: playback.volume } : slot);
  }, [playback.volume, activeSlotId, updateSlot]);

  useEffect(() => {
    updateSlot(activeSlotId, slot => slot.playbackMode !== playback.playbackMode ? { ...slot, playbackMode: playback.playbackMode } : slot);
  }, [playback.playbackMode, activeSlotId, updateSlot]);

  useEffect(() => {
    if (restoreTime > 0) {
      setRestoreTime(0);
    }
  }, [activeTrackIndex, restoreTime]);

  const resetRestoreTime = useCallback(() => setRestoreTime(0), []);

  return {
    ...playback,
    restoreTime,
    setRestoreTime,
    resetRestoreTime,
    activeBlobUrlsRef,
    createTrackedBlobUrl,
    revokeBlobUrl,
  };
}
