import { useEffect, useRef } from 'react';
import type { Track } from '../types';
import {
  EMPTY_SYSTEM_LYRICS_STATE,
  type SystemLyricsAction,
} from '../types/systemLyrics';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import { buildSystemLyricsState } from '../services/systemLyricsState';

const UPDATE_RETRY_BASE_DELAY_MS = 250;
const UPDATE_RETRY_MAX_DELAY_MS = 30_000;
const PLAYING_SAMPLE_INTERVAL_MS = 50;

interface PendingSystemLyricsUpdate {
  generation: number;
  serialized: string;
  state: ReturnType<typeof buildSystemLyricsState>;
}

function isSystemLyricsAction(action: unknown): action is SystemLyricsAction {
  return action === 'toggle-play' || action === 'previous' || action === 'next';
}

export interface UseSystemLyricsOptions {
  currentTrack: Track | null;
  currentTime: number;
  isPlaying: boolean;
  getCurrentPlaybackTime: () => number;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
}

export function useSystemLyrics({
  currentTrack,
  currentTime,
  isPlaying,
  getCurrentPlaybackTime,
  togglePlay,
  next,
  previous,
}: UseSystemLyricsOptions): void {
  const callbacksRef = useRef({ togglePlay, next, previous });
  const enqueueUpdateRef = useRef<(
    state: PendingSystemLyricsUpdate['state'],
    serialized: string,
  ) => void>();
  const playbackRef = useRef({
    currentTrack,
    currentTime,
    isPlaying,
    getCurrentPlaybackTime,
  });
  const publishSnapshotRef = useRef<() => void>();
  callbacksRef.current = { togglePlay, next, previous };
  playbackRef.current = {
    currentTrack,
    currentTime,
    isPlaying,
    getCurrentPlaybackTime,
  };
  publishSnapshotRef.current = () => {
    const playback = playbackRef.current;
    const exactTime = playback.getCurrentPlaybackTime();
    const sampledTime = Number.isFinite(exactTime) && exactTime >= 0
      ? exactTime
      : playback.currentTime;
    const state = buildSystemLyricsState(
      playback.currentTrack,
      sampledTime,
      playback.isPlaying,
    );
    enqueueUpdateRef.current?.(state, JSON.stringify(state));
  };

  useEffect(() => {
    const bridge = getDesktopAPI()?.ipc?.systemLyrics;
    if (!bridge) return;

    let active = true;
    let desired: PendingSystemLyricsUpdate | null = null;
    let published = '';
    let generation = 0;
    let inFlight = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetry = () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    };

    const scheduleRetry = (flush: () => void) => {
      if (!active || retryTimer !== null) return;
      const delay = Math.min(
        UPDATE_RETRY_BASE_DELAY_MS * (2 ** Math.min(retryAttempt, 7)),
        UPDATE_RETRY_MAX_DELAY_MS,
      );
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!active) return;
        if (desired?.serialized === published) {
          retryAttempt = 0;
          return;
        }
        flush();
      }, delay);
    };

    const flush = () => {
      if (
        !active
        || inFlight
        || retryTimer !== null
        || !desired
        || desired.serialized === published
      ) return;

      const request = desired;
      inFlight = true;
      void bridge.update(request.state).then(result => {
        if (!active) return;
        if (!result.ok) {
          logger.warn('[SystemLyrics] Native surface update failed:', result.error);
          // Cursor samples may replace `desired` while this request is in flight.
          // Back off the transport itself, then retry whichever snapshot is latest.
          scheduleRetry(flush);
          return;
        }

        retryAttempt = 0;
        // Only the latest desired generation may confirm the dedupe marker.
        // Older successful requests are followed immediately by the latest one.
        if (desired?.generation === request.generation) {
          published = request.serialized;
        }
      }).catch(error => {
        if (!active) return;
        logger.warn('[SystemLyrics] Failed to publish native lyrics state:', error);
        scheduleRetry(flush);
      }).finally(() => {
        inFlight = false;
        if (!active) return;
        if (retryTimer === null && desired?.generation !== request.generation) flush();
      });
    };

    enqueueUpdateRef.current = (state, serialized) => {
      if (!active || desired?.serialized === serialized) return;
      desired = { generation: ++generation, serialized, state };
      flush();
    };

    const unsubscribe = bridge.onAction((action: SystemLyricsAction) => {
      if (!isSystemLyricsAction(action)) return;
      const callbacks = callbacksRef.current;
      if (action === 'toggle-play') callbacks.togglePlay();
      else if (action === 'next') callbacks.next();
      else if (action === 'previous') callbacks.previous();
    });

    return () => {
      active = false;
      enqueueUpdateRef.current = undefined;
      desired = null;
      clearRetry();
      unsubscribe();
      void bridge.update(EMPTY_SYSTEM_LYRICS_STATE).catch(error => {
        logger.warn('[SystemLyrics] Failed to clear native lyrics surface:', error);
      });
    };
  }, []);

  useEffect(() => {
    const bridge = getDesktopAPI()?.ipc?.systemLyrics;
    if (!bridge) return;

    publishSnapshotRef.current?.();
  }, [currentTrack, currentTime, getCurrentPlaybackTime, isPlaying]);

  useEffect(() => {
    const desktop = getDesktopAPI();
    if (
      !currentTrack
      || !isPlaying
      || desktop?.platform !== 'darwin'
      || !desktop.ipc?.systemLyrics
    ) return;

    const sampleTimer = setInterval(() => {
      publishSnapshotRef.current?.();
    }, PLAYING_SAMPLE_INTERVAL_MS);
    return () => clearInterval(sampleTimer);
  }, [currentTrack?.id, isPlaying]);
}
