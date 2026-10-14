import { useCallback, useEffect, useState } from 'react';
import type { Track } from '../types';
import { useBlobUrls } from './useBlobUrls';
import { usePlayback } from './usePlayback';

interface PlayerStoreOptions {
  activeTracks: Track[];
  activeTrackIndex: number;
  setActiveTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  setActiveTrackIndex: (index: number | ((prev: number) => number)) => void;
  onTrackSwitch: () => void;
}

export function usePlayerStore({
  activeTracks,
  activeTrackIndex,
  setActiveTracks,
  setActiveTrackIndex,
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

  // Volume and playback mode are global while playing. The persistence
  // snapshot stores them on the active slot (see AppContent), so they are not
  // mirrored into slot state on every change.
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
