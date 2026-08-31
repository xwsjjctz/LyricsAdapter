import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Track } from '../types';
import {
  DEFAULT_COVER_ARTWORK_URL,
  toCoverThumb,
} from '../services/coverUrl';
import { logger } from '../services/logger';

const DEFAULT_SEEK_OFFSET_SECONDS = 10;
const MEDIA_SESSION_ARTWORK_SIZE = 256;

interface MediaSessionPlaybackIntent {
  currentTrack: Track | null;
  isPlaying: boolean;
  duration: number;
  getCurrentPlaybackTime: () => number;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
}

export interface UseMediaSessionOptions extends MediaSessionPlaybackIntent {
  /**
   * React's throttled playback clock. The hook reads the exact clock through
   * getCurrentPlaybackTime; this value only schedules position-state refreshes.
   */
  currentTime: number;
}

function getMediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;

  try {
    return navigator.mediaSession ?? null;
  } catch {
    return null;
  }
}

function clampSeekTarget(time: number, duration: number): number | null {
  if (!Number.isFinite(time)) return null;
  const nonNegativeTime = Math.max(0, time);
  return Number.isFinite(duration) && duration > 0
    ? Math.min(nonNegativeTime, duration)
    : nonNegativeTime;
}

function seekOffset(details: MediaSessionActionDetails): number {
  const offset = details.seekOffset;
  return Number.isFinite(offset) && offset !== undefined && offset > 0
    ? offset
    : DEFAULT_SEEK_OFFSET_SECONDS;
}

function clearPositionState(mediaSession: MediaSession): void {
  try {
    mediaSession.setPositionState();
  } catch (error) {
    logger.debug('[MediaSession] Failed to clear position state:', error);
  }
}

function buildArtwork(src: string, type?: string): MediaImage {
  return {
    src,
    sizes: `${MEDIA_SESSION_ARTWORK_SIZE}x${MEDIA_SESSION_ARTWORK_SIZE}`,
    ...(type ? { type } : {}),
  };
}

function publishMetadata(
  mediaSession: MediaSession,
  metadata: MediaMetadataInit,
  artwork?: MediaImage,
): void {
  try {
    mediaSession.metadata = new MediaMetadata({
      ...metadata,
      ...(artwork ? { artwork: [artwork] } : {}),
    });
  } catch (error) {
    // An invalid or platform-inaccessible artwork URL must not suppress the
    // text metadata. Retry once without artwork before giving up.
    if (artwork) {
      try {
        mediaSession.metadata = new MediaMetadata(metadata);
        logger.debug('[MediaSession] Published metadata without artwork:', error);
        return;
      } catch {
        // Fall through to the shared warning below.
      }
    }
    logger.warn('[MediaSession] Failed to publish metadata:', error);
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Artwork reader returned a non-string result'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read artwork'));
    reader.onabort = () => reject(new DOMException('Artwork read aborted', 'AbortError'));
    reader.readAsDataURL(blob);
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Publishes LyricsAdapter's active player to the platform Media Session API.
 *
 * Chromium maps this API to Windows SMTC and macOS Now Playing. All incoming
 * actions stay inside the existing player intent boundary; this hook never
 * mutates library-slot state or controls the media element directly.
 */
export function useMediaSession({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  getCurrentPlaybackTime,
  togglePlay,
  next,
  previous,
  seek,
}: UseMediaSessionOptions): void {
  const latestIntentRef = useRef<MediaSessionPlaybackIntent>({
    currentTrack,
    isPlaying,
    duration,
    getCurrentPlaybackTime,
    togglePlay,
    next,
    previous,
    seek,
  });

  useLayoutEffect(() => {
    latestIntentRef.current = {
      currentTrack,
      isPlaying,
      duration,
      getCurrentPlaybackTime,
      togglePlay,
      next,
      previous,
      seek,
    };
  }, [currentTrack, duration, getCurrentPlaybackTime, isPlaying, next, previous, seek, togglePlay]);

  const hasTrack = currentTrack !== null;

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!mediaSession || !hasTrack) return;

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => {
        const intent = latestIntentRef.current;
        if (intent.currentTrack && !intent.isPlaying) intent.togglePlay();
      }],
      ['pause', () => {
        const intent = latestIntentRef.current;
        if (intent.currentTrack && intent.isPlaying) intent.togglePlay();
      }],
      ['previoustrack', () => {
        const intent = latestIntentRef.current;
        if (intent.currentTrack) intent.previous();
      }],
      ['nexttrack', () => {
        const intent = latestIntentRef.current;
        if (intent.currentTrack) intent.next();
      }],
      ['seekto', (details) => {
        const intent = latestIntentRef.current;
        if (!intent.currentTrack || !Number.isFinite(details.seekTime)) return;
        const target = clampSeekTarget(details.seekTime!, intent.duration);
        if (target !== null) intent.seek(target);
      }],
      ['seekbackward', (details) => {
        const intent = latestIntentRef.current;
        if (!intent.currentTrack) return;
        const target = clampSeekTarget(
          intent.getCurrentPlaybackTime() - seekOffset(details),
          intent.duration,
        );
        if (target !== null) intent.seek(target);
      }],
      ['seekforward', (details) => {
        const intent = latestIntentRef.current;
        if (!intent.currentTrack) return;
        const target = clampSeekTarget(
          intent.getCurrentPlaybackTime() + seekOffset(details),
          intent.duration,
        );
        if (target !== null) intent.seek(target);
      }],
    ];
    const registeredActions: MediaSessionAction[] = [];

    for (const [action, handler] of handlers) {
      try {
        mediaSession.setActionHandler(action, handler);
        registeredActions.push(action);
      } catch (error) {
        // Browser/platform implementations may support only a subset of the
        // standard actions. Keep every other action available when one fails.
        logger.debug(`[MediaSession] Action is unavailable: ${action}`, error);
      }
    }

    return () => {
      for (const action of registeredActions) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch (error) {
          logger.debug(`[MediaSession] Failed to clear action: ${action}`, error);
        }
      }
    };
  }, [hasTrack]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!mediaSession) return;

    if (!currentTrack || typeof MediaMetadata !== 'function') {
      try {
        mediaSession.metadata = null;
      } catch (error) {
        logger.debug('[MediaSession] Failed to clear metadata:', error);
      }
      return;
    }

    const baseMetadata: MediaMetadataInit = {
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
    };
    const coverUrl = toCoverThumb(
      currentTrack.coverUrl?.trim() || DEFAULT_COVER_ARTWORK_URL,
      MEDIA_SESSION_ARTWORK_SIZE,
    ) ?? DEFAULT_COVER_ARTWORK_URL;
    const needsArtworkMaterialization = coverUrl?.startsWith('cover://') ?? false;
    publishMetadata(
      mediaSession,
      baseMetadata,
      !needsArtworkMaterialization
        ? buildArtwork(
          coverUrl,
          coverUrl === DEFAULT_COVER_ARTWORK_URL ? 'image/svg+xml' : undefined,
        )
        : undefined,
    );

    if (!needsArtworkMaterialization) return;

    // Chromium's Media Session sanitizer accepts only http/https/data/blob
    // artwork and silently drops Electron's app-private cover:// scheme.
    // Materialize the bounded thumbnail as a data URL before publishing it.
    const abortController = new AbortController();
    void fetch(coverUrl, { signal: abortController.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Artwork request failed: HTTP ${response.status}`);
        const blob = await response.blob();
        const dataUrl = await readBlobAsDataUrl(blob);
        if (abortController.signal.aborted) return;
        publishMetadata(
          mediaSession,
          baseMetadata,
          buildArtwork(dataUrl, blob.type || undefined),
        );
      })
      .catch(error => {
        if (!isAbortError(error) && !abortController.signal.aborted) {
          logger.debug('[MediaSession] Failed to materialize artwork:', error);
        }
      });

    return () => abortController.abort();
  }, [currentTrack?.album, currentTrack?.artist, currentTrack?.coverUrl, currentTrack?.id, currentTrack?.title]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!mediaSession) return;

    try {
      mediaSession.playbackState = currentTrack
        ? (isPlaying ? 'playing' : 'paused')
        : 'none';
    } catch (error) {
      logger.debug('[MediaSession] Failed to publish playback state:', error);
    }
  }, [currentTrack?.id, isPlaying]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!mediaSession) return;

    if (!currentTrack || !Number.isFinite(duration) || duration <= 0) {
      clearPositionState(mediaSession);
      return;
    }

    try {
      const exactTime = getCurrentPlaybackTime();
      const position = clampSeekTarget(exactTime, duration);
      if (position === null) {
        clearPositionState(mediaSession);
        return;
      }

      mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position,
      });
    } catch (error) {
      logger.debug('[MediaSession] Failed to publish position state:', error);
    }
  }, [currentTime, currentTrack?.id, duration, getCurrentPlaybackTime, isPlaying]);

  useEffect(() => {
    const mediaSession = getMediaSession();
    if (!mediaSession) return;

    return () => {
      try {
        mediaSession.metadata = null;
      } catch {
        // Best-effort cleanup during renderer shutdown or hot reload.
      }
      try {
        mediaSession.playbackState = 'none';
      } catch {
        // Best-effort cleanup during renderer shutdown or hot reload.
      }
      clearPositionState(mediaSession);
    };
  }, []);
}
