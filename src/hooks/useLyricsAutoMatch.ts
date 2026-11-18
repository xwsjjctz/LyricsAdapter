import { useCallback, useEffect, useRef } from 'react';
import type { Track } from '../types';
import type { OnlineLyricsResult } from '../shared/onlineMusic';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import { currentLyricsSources, findLyrics, lyricsQueryFor, needsLyricsMatch } from '../services/lyrics/lyricsAutoMatch';
import { rememberLyricsMatchTried, wasLyricsMatchTried } from '../services/storage/lyricsMatchAttempts';
import { metadataCacheService } from '../services/storage/metadataCacheService';
import { settingsManager } from '../services/storage/settingsManager';

interface UseLyricsAutoMatchOptions {
  /** The library has finished loading. Tracks already in it are matched when played, not all at once. */
  ready: boolean;
  localTracks: Track[];
  /** Latest local tracks, including updates not rendered yet. */
  getLocalTracks: () => Track[];
  /** The playing track, whichever library it belongs to. */
  currentTrackId: string | undefined;
  /** Stores lyrics on a local track that has none; owned by the library controller. */
  applyMatchedLyrics: (trackId: string, lyrics: OnlineLyricsResult) => boolean;
}

/** One track at a time with a pause between them, so a large import does not flood a music platform. */
const PAUSE_BETWEEN_TRACKS_MS = 1200;
/** Lyrics of the playing track may still arrive from the metadata cache; give that a moment first. */
const PLAYING_TRACK_DELAY_MS = 3000;

/**
 * Looks up lyrics in the background for local tracks that have none: every
 * newly imported track, and an older track when it is played. Each track is
 * tried once (see lyricsMatchAttempts); a failed network leaves it for a later
 * session. Nothing here writes library state: results go to the controller.
 */
export function useLyricsAutoMatch({
  ready,
  localTracks,
  getLocalTracks,
  currentTrackId,
  applyMatchedLyrics,
}: UseLyricsAutoMatchOptions): void {
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const mounted = useRef(true);
  /** Tracks whose lookup already ran this session, whatever the outcome. */
  const visited = useRef(new Set<string>());
  /** Ids seen in the local library; null until the loaded library is taken as the baseline. */
  const known = useRef<Set<string> | null>(null);
  const latest = useRef({ getLocalTracks, applyMatchedLyrics });
  latest.current = { getLocalTracks, applyMatchedLyrics };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      // Switching the lookup off also stops what is already queued.
      while (mounted.current && queue.current.length > 0 && settingsManager.getLyricsAutoMatch()) {
        const trackId = queue.current.shift()!;
        const track = latest.current.getLocalTracks().find(candidate => candidate.id === trackId);
        if (!track || !needsLyricsMatch(track) || visited.current.has(trackId) || wasLyricsMatchTried(trackId)) continue;
        visited.current.add(trackId);
        try {
          const outcome = await findLyrics(lyricsQueryFor(track), await currentLyricsSources());
          if (!mounted.current) return;
          if (outcome.lyrics) latest.current.applyMatchedLyrics(trackId, outcome.lyrics);
          // An unreachable source is not an answer; the track stays eligible for a later session.
          if (outcome.conclusive) rememberLyricsMatchTried(trackId);
        } catch (error) {
          logger.warn('[LyricsMatch] Lookup failed for', track.title, error);
        }
        await new Promise(resolve => setTimeout(resolve, PAUSE_BETWEEN_TRACKS_MS));
      }
    } finally {
      running.current = false;
    }
  }, []);

  const enqueue = useCallback((trackIds: string[], first = false) => {
    if (!settingsManager.getLyricsAutoMatch()) return;
    const fresh = trackIds.filter(id => !visited.current.has(id) && !queue.current.includes(id));
    if (fresh.length === 0) return;
    queue.current = first ? [...fresh, ...queue.current] : [...queue.current, ...fresh];
    void run();
  }, [run]);

  // Newly added local tracks (imports, downloads) are looked up as they arrive.
  useEffect(() => {
    if (!ready || !getDesktopAPI()) return;
    if (!known.current) {
      known.current = new Set(localTracks.map(track => track.id));
      return;
    }
    const added = localTracks.filter(track => !known.current!.has(track.id));
    for (const track of added) known.current.add(track.id);
    enqueue(added.filter(needsLyricsMatch).map(track => track.id));
  }, [ready, localTracks, enqueue]);

  // A track from before this feature, or one whose lookup could not complete, gets its turn when played.
  useEffect(() => {
    if (!ready || !currentTrackId || !getDesktopAPI()) return;
    const timer = setTimeout(() => {
      const track = latest.current.getLocalTracks().find(candidate => candidate.id === currentTrackId);
      if (!track || !needsLyricsMatch(track)) return;
      const cached = metadataCacheService.get(track.id);
      if (cached?.lyrics?.trim() || cached?.syncedLyrics?.length) return;
      enqueue([track.id], true);
    }, PLAYING_TRACK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, currentTrackId, enqueue]);
}
