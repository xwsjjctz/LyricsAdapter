import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';

export const CLOCK_RESYNC_THRESHOLD_SECONDS = 0.25;

interface FocusPlaybackClockOptions {
  trackId: string | undefined;
  isVisible: boolean;
  currentTime: number;
  isPlaying: boolean;
  getCurrentPlaybackTime: () => number;
}

interface FocusPlaybackClock {
  activeCurrentTime: number;
  realtimeCurrentTimeRef: MutableRefObject<number>;
}

/**
 * Drives Focus lyrics from the playback engine's track-owned clock. The
 * guarded getter deliberately remains the only exact-time source here: the
 * selected track can change up to 150ms before its media source is replaced.
 */
export function useFocusPlaybackClock({
  trackId,
  isVisible,
  currentTime,
  isPlaying,
  getCurrentPlaybackTime,
}: FocusPlaybackClockOptions): FocusPlaybackClock {
  const initialOwnedTimeRef = useRef<number | null>(null);
  if (initialOwnedTimeRef.current === null) {
    initialOwnedTimeRef.current = getCurrentPlaybackTime();
  }
  const [realtimeCurrentTime, setRealtimeCurrentTime] = useState(initialOwnedTimeRef.current);
  const realtimeCurrentTimeRef = useRef(initialOwnedTimeRef.current);
  const lastUpdateRef = useRef(0);
  const lastTimeRef = useRef(initialOwnedTimeRef.current);
  const clockTrackIdRef = useRef(trackId);

  useEffect(() => {
    if (!isVisible || !isPlaying) return;

    lastTimeRef.current = getCurrentPlaybackTime();
    let animationId = 0;
    const updateTime = (timestamp: number) => {
      const ownedTime = getCurrentPlaybackTime();
      realtimeCurrentTimeRef.current = ownedTime;

      if (timestamp - lastUpdateRef.current > 50) {
        lastUpdateRef.current = timestamp;
        if (ownedTime !== lastTimeRef.current) {
          lastTimeRef.current = ownedTime;
          setRealtimeCurrentTime(ownedTime);
        }
      }
      animationId = requestAnimationFrame(updateTime);
    };

    animationId = requestAnimationFrame(updateTime);
    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [getCurrentPlaybackTime, isPlaying, isVisible, trackId]);

  // `currentTime` intentionally triggers correction attempts, but the value
  // itself is never trusted: it can still belong to the previous track while a
  // debounced source replacement is pending.
  useLayoutEffect(() => {
    const ownedTime = getCurrentPlaybackTime();
    if (!Number.isFinite(ownedTime) || ownedTime < 0) return;

    if (clockTrackIdRef.current !== trackId) {
      clockTrackIdRef.current = trackId;
      realtimeCurrentTimeRef.current = ownedTime;
      lastTimeRef.current = ownedTime;
      setRealtimeCurrentTime(ownedTime);
      return;
    }

    const drift = Math.abs(realtimeCurrentTimeRef.current - ownedTime);
    if (!isPlaying || drift >= CLOCK_RESYNC_THRESHOLD_SECONDS) {
      realtimeCurrentTimeRef.current = ownedTime;
      lastTimeRef.current = ownedTime;
      setRealtimeCurrentTime(ownedTime);
    }
  }, [currentTime, getCurrentPlaybackTime, isPlaying, trackId]);

  const ownedCurrentTime = getCurrentPlaybackTime();
  const clockMatchesTrack = clockTrackIdRef.current === trackId;
  if (!isPlaying) realtimeCurrentTimeRef.current = ownedCurrentTime;

  return {
    activeCurrentTime: isVisible
      ? (isPlaying && clockMatchesTrack ? realtimeCurrentTime : ownedCurrentTime)
      : currentTime,
    realtimeCurrentTimeRef,
  };
}
