import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { SlotId, Track } from '../types';
import { getOnlineProvider } from '../services/onlineMusicProvider';
import type { OnlineLyricsResult, OnlineSong, OnlineSource } from '../services/onlineMusicProvider';
import { parseLyrics } from '../services/metadataService';
import { PROVIDER_LYRICS_PARTIAL_TTL_MS } from '../services/providerLyricsCache';
import { onlineSongToTrack } from '../domain/trackFactory';

const PLAYLIST_PAGE_SIZE = 30;
const LYRICS_UPGRADE_ATTEMPT_LIMIT = 256;
const PLAYLIST_LYRICS_PREFETCH_DELAY_MS = 120;
const PLAYLIST_LYRICS_MAX_ACTIVE_REQUESTS = 3;

interface PlaylistLoadState {
  source: OnlineSource;
  playlistId: string | null;
  title: string | null;
  totalTrackCount: number | null;
  nextOffset: number;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
}

const IDLE_PLAYLIST_LOAD_STATE: PlaylistLoadState = {
  source: 'qq',
  playlistId: null,
  title: null,
  totalTrackCount: null,
  nextOffset: 0,
  hasMore: false,
  isLoading: false,
  error: null,
};

function playlistErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Failed to load playlist';
}

function appendUniqueTracks(existing: Track[], incoming: Track[]): Track[] {
  const existingIds = new Set(existing.map(track => track.id));
  return [...existing, ...incoming.filter(track => !existingIds.has(track.id))];
}

function hasLyrics(track: Track): boolean {
  return Boolean(track.lyrics || track.syncedLyrics?.length);
}

function hasWordTimedLyrics(track: Track): boolean {
  return Boolean(track.syncedLyrics?.some((line) => line.words?.length));
}

function isProviderTrack(track: Track): track is Track & { source: OnlineSource; songmid: string } {
  return Boolean(
    track.songmid
    && (track.source === 'qq' || track.source === 'netease' || track.source === 'soda')
  );
}

function providerTrackKey(track: Track): string | null {
  return isProviderTrack(track) ? `${track.source}:${track.songmid}` : null;
}

function trackLyricsState(track: Track | undefined): 'none' | 'line' | 'word' {
  if (!track || !hasLyrics(track)) return 'none';
  return hasWordTimedLyrics(track) ? 'word' : 'line';
}

function playlistLyricsWindowIndices(length: number, currentIndex: number): number[] {
  if (length <= 0 || currentIndex < 0 || currentIndex >= length) return [];
  const candidates = [
    currentIndex,
    (currentIndex - 1 + length) % length,
    (currentIndex + 1) % length,
  ];
  return candidates.filter((index, position) => candidates.indexOf(index) === position);
}

function wasUpgradeAttempted(attempts: Map<string, number>, key: string): boolean {
  const attemptedAt = attempts.get(key);
  if (attemptedAt === undefined) return false;
  if (Date.now() - attemptedAt >= PROVIDER_LYRICS_PARTIAL_TTL_MS) {
    attempts.delete(key);
    return false;
  }
  attempts.delete(key);
  attempts.set(key, attemptedAt);
  return true;
}

function rememberUpgradeAttempt(attempts: Map<string, number>, key: string): void {
  attempts.delete(key);
  attempts.set(key, Date.now());
  while (attempts.size > LYRICS_UPGRADE_ATTEMPT_LIMIT) {
    const oldestKey = attempts.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    attempts.delete(oldestKey);
  }
}

function mergeProviderLyrics(track: Track, lyricsResult: OnlineLyricsResult): Track {
  const parsed = parseLyrics(
    lyricsResult.lyrics,
    lyricsResult.wordLyrics,
    lyricsResult.wordLyricsFormat,
  );
  return {
    ...track,
    lyrics: parsed.plainText || lyricsResult.lyrics,
    ...(parsed.syncedLyrics ? { syncedLyrics: parsed.syncedLyrics } : {}),
  };
}

function applyEnrichedLyrics(current: Track, enriched: Track): Track {
  return {
    ...current,
    ...(enriched.lyrics !== undefined ? { lyrics: enriched.lyrics } : {}),
    ...(enriched.syncedLyrics !== undefined ? { syncedLyrics: enriched.syncedLyrics } : {}),
  };
}

/**
 * Player Controller (Phase 1 of the refactor roadmap).
 *
 * Owns playback *intent* orchestration that previously lived in AppWorkspace:
 * cross-slot selection, search-result navigation, online stream play and
 * playlist play. It does NOT own the <audio> lifecycle, URL resolution, or
 * error recovery — those stay in usePlayback.
 *
 * Migration policy (roadmap Rule 1): logic is moved here verbatim from
 * AppWorkspace, not redesigned. Dep arrays are reproduced exactly to avoid
 * accidental behaviour changes; any known dep-array gaps are recorded in
 * docs/refactor-backlog.md rather than fixed here.
 */

export interface PlayerControllerOptions {
  /** Library store state */
  activeSlotId: SlotId;
  viewSlot: SlotId;
  /** Local/cloud tracks, read by global-search navigation. */
  localTracks: Track[];
  cloudTracks: Track[];
  /** Set the slot the library panel is browsing. */
  setViewSlot: (slotId: SlotId) => void;
  /** Mutate a slot's state imperatively (from useLibrarySlots). */
  updateSlot: (slotId: SlotId, updater: (slot: any) => any) => void;
  /** Switch the active play context to another slot (from useLibrarySlots). */
  switchTo: (slotId: SlotId) => void;
  /** Push a track onto the front of the online (LRU) slot (from useLibrarySlots). */
  addOnlineTrack: (track: Track) => void;
  /** Replace the online slot's tracks (from useLibrarySlots). */
  updateOnlineTracks: (updater: Track[] | ((prev: Track[]) => Track[])) => void;
  /** Online slot tracks/current index, used to upgrade persisted line-only lyrics. */
  onlineTracks: Track[];
  onlineCurrentIndex: number;
  /** Load a full track list into the playlist slot (from useLibrarySlots). */
  loadPlaylistTracks: (tracks: Track[]) => void;
  /** Replace the playlist slot's tracks (from useLibrarySlots). */
  updatePlaylistTracks: (updater: Track[] | ((prev: Track[]) => Track[])) => void;
  /** Playlist slot tracks (read by the lyrics sliding-window effect). */
  playlistTracks: Track[];
  /** Playlist slot current index (read by the lyrics sliding-window effect). */
  playlistCurrentIndex: number;

  /** Player store (from usePlayback) */
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  shouldAutoPlayRef: MutableRefObject<boolean>;
  selectTrack: (index: number) => void;
  setIsPlaying: (playing: boolean) => void;
  /** From playerStore (not usePlayback). */
  setRestoreTime: (time: number) => void;

  /** UI store */
  markTrackSwitch: () => void;
}

export function usePlayerController(options: PlayerControllerOptions) {
  const {
    activeSlotId,
    viewSlot,
    localTracks,
    cloudTracks,
    setViewSlot,
    updateSlot,
    switchTo,
    addOnlineTrack,
    updateOnlineTracks,
    onlineTracks,
    onlineCurrentIndex,
    loadPlaylistTracks,
    updatePlaylistTracks,
    playlistTracks,
    playlistCurrentIndex,
    audioRef,
    shouldAutoPlayRef,
    selectTrack,
    setIsPlaying,
    setRestoreTime,
    markTrackSwitch,
  } = options;

  // ── Browse/play decoupling for third-party playlists ───────────────────────
  const [libraryPlaylistLoadState, setLibraryPlaylistLoadState] = useState<PlaylistLoadState>(IDLE_PLAYLIST_LOAD_STATE);
  // The playlist being browsed in the Library list. Decoupled from
  // the 'playlist' play slot so opening a playlist never interrupts playback —
  // the slot is only populated when the user actually clicks a track to play.
  const [libraryBrowsingTracks, setLibraryBrowsingTracks] = useState<Track[]>([]);
  const libraryGenerationRef = useRef(0);
  const libraryLoadingRef = useRef(false);
  const lyricsRequestsInFlightRef = useRef(new Map<string, Promise<OnlineLyricsResult | null>>());
  const lyricsUpgradeAttemptedRef = useRef(new Map<string, number>());
  const playlistLyricsSubscriptionsRef = useRef(new Set<string>());
  const playlistLyricsWaitingForCapacityRef = useRef(false);
  const lyricsControllerMountedRef = useRef(true);
  const [lyricsRequestRevision, setLyricsRequestRevision] = useState(0);

  const playlistLyricsWindow = activeSlotId === 'playlist'
    ? playlistLyricsWindowIndices(playlistTracks.length, playlistCurrentIndex).map((index) => {
        const track = playlistTracks[index];
        return {
          index,
          id: track?.id ?? '',
          providerKey: track ? providerTrackKey(track) : null,
        };
      })
    : [];
  const latestPlaylistLyricsWindowRef = useRef(playlistLyricsWindow);
  const playlistLyricsWindowKey = activeSlotId === 'playlist'
    ? JSON.stringify([
        playlistTracks.length,
        playlistCurrentIndex,
        ...playlistLyricsWindow.map(entry => [
          entry.index,
          entry.id,
          entry.providerKey,
          trackLyricsState(playlistTracks[entry.index]),
        ]),
      ])
    : 'inactive';
  const committedPlaylistLyricsWindowKeyRef = useRef<string | null>(playlistLyricsWindowKey);

  useLayoutEffect(() => {
    const committedWindow = playlistLyricsWindow;
    latestPlaylistLyricsWindowRef.current = committedWindow;
    committedPlaylistLyricsWindowKeyRef.current = playlistLyricsWindowKey;
    return () => {
      if (latestPlaylistLyricsWindowRef.current === committedWindow) {
        latestPlaylistLyricsWindowRef.current = [];
      }
      if (committedPlaylistLyricsWindowKeyRef.current === playlistLyricsWindowKey) {
        committedPlaylistLyricsWindowKeyRef.current = null;
      }
    };
  }, [playlistLyricsWindowKey]);

  useEffect(() => {
    lyricsControllerMountedRef.current = true;
    return () => {
      lyricsControllerMountedRef.current = false;
      playlistLyricsWaitingForCapacityRef.current = false;
    };
  }, []);

  const handleLyricsRequestSettled = useCallback(() => {
    if (
      lyricsControllerMountedRef.current
      && playlistLyricsWaitingForCapacityRef.current
    ) {
      playlistLyricsWaitingForCapacityRef.current = false;
      setLyricsRequestRevision(revision => revision + 1);
    }
  }, []);

  /**
   * Share each active provider request between all consumers. Tracks that have
   * line-level lyrics retry karaoke upgrades on the partial-cache interval;
   * tracks whose lyrics were evicted remain reloadable on window re-entry.
   */
  const enrichProviderTrackLyrics = useCallback(async (track: Track): Promise<Track | undefined> => {
    if (!isProviderTrack(track) || hasWordTimedLyrics(track)) return undefined;

    const requestKey = `${track.source}:${track.songmid}`;
    const isUpgrade = hasLyrics(track);
    if (isUpgrade && wasUpgradeAttempted(lyricsUpgradeAttemptedRef.current, requestKey)) {
      return undefined;
    }

    let request = lyricsRequestsInFlightRef.current.get(requestKey);
    if (!request) {
      let newRequest!: Promise<OnlineLyricsResult | null>;
      newRequest = (async () => {
        try {
          return await getOnlineProvider(track.source).getLyrics(track.songmid);
        } finally {
          if (lyricsRequestsInFlightRef.current.get(requestKey) === newRequest) {
            lyricsRequestsInFlightRef.current.delete(requestKey);
          }
          handleLyricsRequestSettled();
        }
      })();
      lyricsRequestsInFlightRef.current.set(requestKey, newRequest);
      request = newRequest;
    }

    const lyricsResult = await request;
    if (!lyricsResult) return undefined;
    const enrichedTrack = mergeProviderLyrics(track, lyricsResult);
    if (!hasWordTimedLyrics(enrichedTrack)) {
      rememberUpgradeAttempt(lyricsUpgradeAttemptedRef.current, requestKey);
    }
    return enrichedTrack;
  }, [handleLyricsRequestSettled]);

  const loadPlaylistPage = useCallback(async (source: OnlineSource, playlistId: string, offset: number) => {
    const provider = getOnlineProvider(source);
    const songs = await provider.getPlaylistSongs(playlistId, offset, PLAYLIST_PAGE_SIZE);
    return {
      tracks: songs.map(song => onlineSongToTrack(song, source)),
      count: songs.length,
    };
  }, []);

  // Track selection handler that handles cross-slot selection.
  // `targetSlotId` lets a caller state explicitly which slot owns the clicked
  // row. Ordinary library callers omit it and fall back to viewSlot.
  const handleTrackSelect = useCallback((trackIndex: number, targetSlotId?: SlotId) => {
    const playSlot = targetSlotId ?? viewSlot;

    if (playSlot === activeSlotId) {
      selectTrack(trackIndex);
      return;
    }

    // Cross-slot: save playing slot's time, switch active slot, then play.
    updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
    updateSlot(playSlot, s => ({ ...s, currentTrackIndex: trackIndex }));
    setRestoreTime(0);
    markTrackSwitch();
    switchTo(playSlot);
    shouldAutoPlayRef.current = true;
    setIsPlaying(true);
  }, [viewSlot, activeSlotId, selectTrack, updateSlot, switchTo, setIsPlaying, audioRef, markTrackSwitch]);

  // Global-search navigation: locate a track in local/cloud, then play it.
  // Same active+view slot → simple selection; cross-slot → save time, switch
  // active slot, autoplay; cross-view only → select and sync the view below.
  const handleSearchNavigate = useCallback((track: Track) => {
    const targetSlot: 'local' | 'cloud' = track.source === 'webdav' ? 'cloud' : 'local';
    const targetTracks = targetSlot === 'local' ? localTracks : cloudTracks;
    const idx = targetTracks.findIndex(t => t.id === track.id);
    if (idx < 0) return;
    if (targetSlot === activeSlotId && targetSlot === viewSlot) {
      // Same slot, same view: simple track selection
      selectTrack(idx);
      return;
    }
    // Cross-slot or cross-view: save playing slot's time, update target, switch
    if (targetSlot !== activeSlotId) {
      updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
      updateSlot(targetSlot, s => ({ ...s, currentTrackIndex: idx }));
      setRestoreTime(0);
      switchTo(targetSlot);
      shouldAutoPlayRef.current = true;
      setIsPlaying(true);
    } else {
      // Same slot, different view: just select track (view will sync below)
      selectTrack(idx);
    }
    // Sync view to match the playing slot
    setViewSlot(targetSlot);
  }, [activeSlotId, viewSlot, localTracks, cloudTracks, selectTrack, audioRef, updateSlot, switchTo, setIsPlaying]);

  // Click a third-party search result → stream it via stream:// protocol
  // and record in the online-playback slot (LRU, most-recent at head).
  // Accepts the pre-normalized inline shape used by the original AppWorkspace
  // handler; UI callers use playOnlineSong below which normalizes OnlineSong.
  const handleOnlineStreamPlay = useCallback(async (song: {
    songmid: string; title: string; artist: string; album: string;
    coverUrl?: string; duration: number; singer?: { name: string }[];
  }, sourceOverride?: OnlineSource) => {
    const source = sourceOverride ?? getOnlineProvider().id;
    const track: Track = {
      id: `online-${source}-${song.songmid}`,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration || 0,
      coverUrl: song.coverUrl,
      audioUrl: '',
      source,
      songmid: song.songmid,
    };
    // Save current slot's playback position
    updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
    // Add to online slot (LRU push to front → always at index 0)
    addOnlineTrack(track);
    updateSlot('online', s => ({ ...s, currentTrackIndex: 0 }));
    // Cross-slot switch (active + view)
    setRestoreTime(0);
    switchTo('online');
    shouldAutoPlayRef.current = true;
    setIsPlaying(true);
    setViewSlot('online');
    // Async metadata/lyrics enrichment
    enrichProviderTrackLyrics(track).then(enrichedTrack => {
      if (!enrichedTrack) return;
      updateOnlineTracks(prev => prev.map(t => (
        t.id === track.id ? applyEnrichedLyrics(t, enrichedTrack) : t
      )));
    }).catch(() => {});
  }, [addOnlineTrack, updateOnlineTracks, updateSlot, activeSlotId, audioRef, setRestoreTime, switchTo, setIsPlaying, shouldAutoPlayRef, setViewSlot, enrichProviderTrackLyrics]);

  // UI-facing adapter: normalize an OnlineSong into the shape the internal
  // handler expects. Keeping the normalization here gives every search surface
  // the same Track shape and cover fallback behavior.
  const playOnlineSong = useCallback((song: OnlineSong, sourceOverride?: OnlineSource) => {
    void handleOnlineStreamPlay({
      songmid: song.songmid,
      title: song.songname,
      artist: song.singer?.map(s => s.name).join(' & ') || 'Unknown Artist',
      album: song.albumname || 'Unknown Album',
      ...(song.coverUrl ? { coverUrl: song.coverUrl } : {}),
      duration: song.interval || 0,
      singer: song.singer,
    }, sourceOverride);
  }, [handleOnlineStreamPlay]);

  // Persisted online history may predate word-timed lyrics. Upgrade the active
  // item lazily instead of invalidating or rewriting the whole library index.
  const activeOnlineTrack = onlineTracks[onlineCurrentIndex];
  useEffect(() => {
    if (activeSlotId !== 'online' || !activeOnlineTrack || hasWordTimedLyrics(activeOnlineTrack)) return;
    const trackId = activeOnlineTrack.id;
    void enrichProviderTrackLyrics(activeOnlineTrack)
      .then(enrichedTrack => {
        if (!enrichedTrack) return;
        updateOnlineTracks(prev => prev.map(track => (
          track.id === trackId ? applyEnrichedLyrics(track, enrichedTrack) : track
        )));
      })
      .catch(() => { /* lyrics are best-effort */ });
  }, [activeSlotId, activeOnlineTrack, enrichProviderTrackLyrics, updateOnlineTracks]);

  // Open a playlist as a Library list without starting playback.
  // The browsed tracks live in libraryBrowsingTracks (NOT the 'playlist' play
  // slot), so opening a playlist while another is playing never interrupts it.
  // Playback only starts when the user clicks a row (playLibraryPlaylistTrack).
  const openOnlinePlaylistInLibrary = useCallback(async (
    source: OnlineSource,
    playlistId: string,
    playlistTitle: string,
    totalTrackCount: number,
  ) => {
    const generation = libraryGenerationRef.current + 1;
    libraryGenerationRef.current = generation;
    libraryLoadingRef.current = true;
    setLibraryBrowsingTracks([]);
    setLibraryPlaylistLoadState({
      source,
      playlistId,
      title: playlistTitle,
      totalTrackCount,
      nextOffset: 0,
      hasMore: true,
      isLoading: true,
      error: null,
    });

    try {
      const page = await loadPlaylistPage(source, playlistId, 0);
      if (generation !== libraryGenerationRef.current) return;
      setLibraryBrowsingTracks(page.tracks);
      setLibraryPlaylistLoadState({
        source,
        playlistId,
        title: playlistTitle,
        totalTrackCount,
        nextOffset: page.count,
        hasMore: page.count === PLAYLIST_PAGE_SIZE,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (generation !== libraryGenerationRef.current) return;
      setLibraryPlaylistLoadState(prev => ({ ...prev, isLoading: false, hasMore: false, error: playlistErrorMessage(error) }));
      throw error;
    } finally {
      if (generation === libraryGenerationRef.current) libraryLoadingRef.current = false;
    }
  }, [loadPlaylistPage]);

  const loadMorePlaylistInLibrary = useCallback(async () => {
    const state = libraryPlaylistLoadState;
    if (!state.playlistId || !state.hasMore || libraryLoadingRef.current) return;

    const generation = libraryGenerationRef.current;
    const { source, playlistId, nextOffset } = state;
    libraryLoadingRef.current = true;
    setLibraryPlaylistLoadState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const page = await loadPlaylistPage(source, playlistId, nextOffset);
      if (generation !== libraryGenerationRef.current) return;
      setLibraryBrowsingTracks(prev => appendUniqueTracks(prev, page.tracks));
      setLibraryPlaylistLoadState(prev => ({
        ...prev,
        nextOffset: nextOffset + page.count,
        hasMore: page.count === PLAYLIST_PAGE_SIZE,
        isLoading: false,
        error: null,
      }));
    } catch (error) {
      if (generation === libraryGenerationRef.current) {
        setLibraryPlaylistLoadState(prev => ({ ...prev, isLoading: false, error: playlistErrorMessage(error) }));
      }
    } finally {
      if (generation === libraryGenerationRef.current) libraryLoadingRef.current = false;
    }
  }, [libraryPlaylistLoadState, loadPlaylistPage]);

  // User clicked a track inside the legacy Library playlist view: commit the
  // browsed list into the 'playlist' play slot (so next/prev traverse it) and
  // start playback at the clicked index. This is the moment browsing becomes
  // playing.
  const playLibraryPlaylistTrack = useCallback((clickedIndex: number) => {
    if (libraryBrowsingTracks.length === 0) return;
    const safeIndex = Math.max(0, Math.min(clickedIndex, libraryBrowsingTracks.length - 1));
    updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
    loadPlaylistTracks(libraryBrowsingTracks);
    updateSlot('playlist', s => ({ ...s, currentTrackIndex: safeIndex }));
    setRestoreTime(0);
    switchTo('playlist');
    shouldAutoPlayRef.current = true;
    setIsPlaying(true);
  }, [libraryBrowsingTracks, loadPlaylistTracks, updateSlot, activeSlotId, audioRef, setRestoreTime, switchTo, setIsPlaying]);

  // Playlist-only circular lyrics window (size 3): prefetch current, previous
  // and next so FocusMode switches are instant even at the list boundaries.
  // Other slots are unaffected — online uses per-click enrichment, local/cloud
  // read lyrics from file metadata.
  useEffect(() => {
    if (
      activeSlotId !== 'playlist'
      || playlistLyricsWindow.length === 0
      || committedPlaylistLyricsWindowKeyRef.current !== playlistLyricsWindowKey
    ) {
      return;
    }

    // Only provider tracks participate: embedded local/WebDAV lyrics must stay.
    updatePlaylistTracks(prev => {
      const liveIndices = new Set(latestPlaylistLyricsWindowRef.current.map(entry => entry.index));
      let changed = false;
      const next = prev.map((t, k) => {
        if (!liveIndices.has(k) && isProviderTrack(t)) {
          if (t.lyrics || (t.syncedLyrics && t.syncedLyrics.length > 0)) {
            changed = true;
            const clone = { ...t };
            delete clone.lyrics;
            delete clone.syncedLyrics;
            return clone;
          }
        }
        return t;
      });
      return changed ? next : prev;
    });

    const timer = window.setTimeout(() => {
      if (committedPlaylistLyricsWindowKeyRef.current !== playlistLyricsWindowKey) return;
      let waitingForCapacity = false;
      for (const entry of playlistLyricsWindow) {
        const track = playlistTracks[entry.index];
        if (!track || !entry.providerKey || !isProviderTrack(track) || hasWordTimedLyrics(track)) continue;

        const requestedIndex = entry.index;
        const requestedId = track.id;
        const requestedProviderKey = entry.providerKey;
        const subscriptionKey = `${requestedIndex}:${requestedId}:${requestedProviderKey}`;
        if (playlistLyricsSubscriptionsRef.current.has(subscriptionKey)) continue;

        if (
          !lyricsRequestsInFlightRef.current.has(requestedProviderKey)
          && lyricsRequestsInFlightRef.current.size >= PLAYLIST_LYRICS_MAX_ACTIVE_REQUESTS
        ) {
          waitingForCapacity = true;
          continue;
        }

        playlistLyricsSubscriptionsRef.current.add(subscriptionKey);
        void enrichProviderTrackLyrics(track)
          .then(enrichedTrack => {
            if (!enrichedTrack) return;
            updatePlaylistTracks(prev => {
              const liveEntry = latestPlaylistLyricsWindowRef.current.find(candidate => (
                candidate.index === requestedIndex
                && candidate.id === requestedId
                && candidate.providerKey === requestedProviderKey
              ));
              if (!liveEntry) return prev;

              const current = prev[liveEntry.index];
              if (
                !current
                || current.id !== requestedId
                || providerTrackKey(current) !== requestedProviderKey
                || hasWordTimedLyrics(current)
                || (hasLyrics(current) && !hasWordTimedLyrics(enrichedTrack))
              ) {
                return prev;
              }

              const next = [...prev];
              next[liveEntry.index] = applyEnrichedLyrics(current, enrichedTrack);
              return next;
            });
          })
          .catch(() => { /* lyrics are best-effort */ })
          .finally(() => {
            playlistLyricsSubscriptionsRef.current.delete(subscriptionKey);
          });
      }
      playlistLyricsWaitingForCapacityRef.current = waitingForCapacity;
    }, PLAYLIST_LYRICS_PREFETCH_DELAY_MS);

    const hasUpgradeableLineLyrics = playlistLyricsWindow.some(entry => {
      const track = playlistTracks[entry.index];
      return Boolean(entry.providerKey)
        && (track?.source === 'qq' || track?.source === 'netease')
        && trackLyricsState(track) === 'line';
    });
    const partialRetryTimer = hasUpgradeableLineLyrics
      ? window.setTimeout(() => {
          if (lyricsControllerMountedRef.current) {
            setLyricsRequestRevision(revision => revision + 1);
          }
        }, PROVIDER_LYRICS_PARTIAL_TTL_MS + 1)
      : undefined;

    return () => {
      window.clearTimeout(timer);
      if (partialRetryTimer !== undefined) window.clearTimeout(partialRetryTimer);
    };
  }, [playlistLyricsWindowKey, lyricsRequestRevision, enrichProviderTrackLyrics, updatePlaylistTracks]);

  return {
    handleTrackSelect,
    handleSearchNavigate,
    handleOnlineStreamPlay,
    playOnlineSong,
    openOnlinePlaylistInLibrary,
    loadMorePlaylistInLibrary,
    libraryPlaylistLoadState,
    libraryBrowsingTracks,
    playLibraryPlaylistTrack,
  };
}
