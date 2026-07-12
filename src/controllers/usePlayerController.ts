import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { SlotId, Track } from '../types';
import { getOnlineProvider } from '../services/onlineMusicProvider';
import type { OnlineLyricsResult, OnlineSong, OnlineSource } from '../services/onlineMusicProvider';
import { parseLyrics } from '../services/metadataService';
import { onlineSongToTrack } from '../domain/trackFactory';

const PLAYLIST_PAGE_SIZE = 30;

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
  // Opening a third-party playlist card must NOT touch the 'playlist' play
  // slot: doing so would overwrite the currently-playing list and set its
  // index to -1, unmounting <audio> and pausing playback. Instead the browsed
  // songs live here in an independent browsing state that the playlist panel
  // reads for display. Playback only starts when the user clicks a track in
  // the panel (playBrowsingTrack).
  const [browsingTracks, setBrowsingTracks] = useState<{ tracks: Track[]; source: OnlineSource }>({ tracks: [], source: 'qq' });
  const [browsingPlaylistLoadState, setBrowsingPlaylistLoadState] = useState<PlaylistLoadState>(IDLE_PLAYLIST_LOAD_STATE);
  const [libraryPlaylistLoadState, setLibraryPlaylistLoadState] = useState<PlaylistLoadState>(IDLE_PLAYLIST_LOAD_STATE);
  const browsingGenerationRef = useRef(0);
  const browsingLoadingRef = useRef(false);
  const libraryGenerationRef = useRef(0);
  const libraryLoadingRef = useRef(false);
  const lyricsRequestsInFlightRef = useRef(new Set<string>());
  const lyricsUpgradeAttemptedRef = useRef(new Set<string>());

  /**
   * Fetch provider lyrics once per active request. Tracks that already have
   * line-level lyrics get one karaoke upgrade attempt per app session; tracks
   * whose lyrics were evicted remain reloadable when they re-enter the window.
   */
  const enrichProviderTrackLyrics = useCallback(async (track: Track): Promise<Track | undefined> => {
    if (!isProviderTrack(track) || hasWordTimedLyrics(track)) return undefined;

    const requestKey = `${track.source}:${track.songmid}`;
    const isUpgrade = hasLyrics(track);
    if (
      lyricsRequestsInFlightRef.current.has(requestKey)
      || (isUpgrade && lyricsUpgradeAttemptedRef.current.has(requestKey))
    ) {
      return undefined;
    }

    lyricsRequestsInFlightRef.current.add(requestKey);
    try {
      const lyricsResult = await getOnlineProvider(track.source).getLyrics(track.songmid);
      if (!lyricsResult) return undefined;
      const enrichedTrack = mergeProviderLyrics(track, lyricsResult);
      if (!hasWordTimedLyrics(enrichedTrack)) {
        lyricsUpgradeAttemptedRef.current.add(requestKey);
      }
      return enrichedTrack;
    } finally {
      lyricsRequestsInFlightRef.current.delete(requestKey);
    }
  }, []);

  const loadPlaylistPage = useCallback(async (source: OnlineSource, playlistId: string, offset: number) => {
    const provider = getOnlineProvider(source);
    const songs = await provider.getPlaylistSongs(playlistId, offset, PLAYLIST_PAGE_SIZE);
    return {
      tracks: songs.map(song => onlineSongToTrack(song, source)),
      count: songs.length,
    };
  }, []);

  // Track selection handler that handles cross-slot selection.
  // `targetSlotId` lets New-UI callers state explicitly which slot the clicked
  // row belongs to (the open panel may show local/cloud tracks while the active
  // play context is the 'playlist' slot — e.g. after opening a third-party
  // playlist card). Legacy callers omit it and fall back to viewSlot.
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
  // handler expects. Moved here from AppWorkspace's two call-site wrappers
  // (NewUxShell + SearchBox). Uses the NewUxShell variant's conditional
  // coverUrl inclusion; the SearchBox variant passed coverUrl unconditionally,
  // but for the resulting Track the two are behaviourally equivalent (an
  // undefined coverUrl vs. an absent key both fall back to the placeholder).
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

  // New UI: opening a third-party playlist card fetches its songs for BROWSING
  // only. It deliberately does NOT load them into the 'playlist' play slot nor
  // switch the active play context — that would pause whatever is currently
  // playing (see bug: 切换歌单暂停正在播放的歌). Playback starts on demand via
  // playBrowsingTrack when the user clicks a track inside the panel.
  const openOnlinePlaylist = useCallback(async (source: OnlineSource, playlistId: string) => {
    const generation = browsingGenerationRef.current + 1;
    browsingGenerationRef.current = generation;
    browsingLoadingRef.current = true;
    setBrowsingTracks({ tracks: [], source });
    setBrowsingPlaylistLoadState({
      source,
      playlistId,
      title: null,
      totalTrackCount: null,
      nextOffset: 0,
      hasMore: true,
      isLoading: true,
      error: null,
    });

    try {
      const page = await loadPlaylistPage(source, playlistId, 0);
      if (generation !== browsingGenerationRef.current) return;
      setBrowsingTracks({ tracks: page.tracks, source });
      setBrowsingPlaylistLoadState({
        source,
        playlistId,
        title: null,
        totalTrackCount: null,
        nextOffset: page.count,
        hasMore: page.count === PLAYLIST_PAGE_SIZE,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (generation !== browsingGenerationRef.current) return;
      setBrowsingPlaylistLoadState(prev => ({ ...prev, isLoading: false, hasMore: false, error: playlistErrorMessage(error) }));
      throw error;
    } finally {
      if (generation === browsingGenerationRef.current) browsingLoadingRef.current = false;
    }
  }, [loadPlaylistPage]);

  const loadMoreBrowsingPlaylist = useCallback(async () => {
    const state = browsingPlaylistLoadState;
    if (!state.playlistId || !state.hasMore || browsingLoadingRef.current) return;

    const generation = browsingGenerationRef.current;
    const { source, playlistId, nextOffset } = state;
    browsingLoadingRef.current = true;
    setBrowsingPlaylistLoadState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const page = await loadPlaylistPage(source, playlistId, nextOffset);
      if (generation !== browsingGenerationRef.current) return;
      setBrowsingTracks(prev => ({
        source: prev.source,
        tracks: prev.source === source ? appendUniqueTracks(prev.tracks, page.tracks) : prev.tracks,
      }));
      setBrowsingPlaylistLoadState(prev => ({
        ...prev,
        nextOffset: nextOffset + page.count,
        hasMore: page.count === PLAYLIST_PAGE_SIZE,
        isLoading: false,
        error: null,
      }));
    } catch (error) {
      if (generation === browsingGenerationRef.current) {
        setBrowsingPlaylistLoadState(prev => ({ ...prev, isLoading: false, error: playlistErrorMessage(error) }));
      }
    } finally {
      if (generation === browsingGenerationRef.current) browsingLoadingRef.current = false;
    }
  }, [browsingPlaylistLoadState, loadPlaylistPage]);

  // Legacy UI: open a playlist as a Library list without starting playback.
  // Playback is delegated to handleTrackSelect when the user clicks a row.
  const openOnlinePlaylistInLibrary = useCallback(async (
    source: OnlineSource,
    playlistId: string,
    playlistTitle: string,
    totalTrackCount: number,
  ) => {
    const generation = libraryGenerationRef.current + 1;
    libraryGenerationRef.current = generation;
    libraryLoadingRef.current = true;
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
      loadPlaylistTracks(page.tracks);
      updateSlot('playlist', slot => ({ ...slot, currentTrackIndex: -1, currentTime: 0 }));
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
  }, [loadPlaylistPage, loadPlaylistTracks, updateSlot]);

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
      updatePlaylistTracks(prev => appendUniqueTracks(prev, page.tracks));
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
  }, [libraryPlaylistLoadState, loadPlaylistPage, updatePlaylistTracks]);

  // User clicked a track inside the browsed third-party playlist panel: load
  // the whole browsed list into the 'playlist' play slot (so next/prev traverse
  // it), start at the clicked index, and begin playback. This is the moment
  // browsing becomes playing.
  const playBrowsingTrack = useCallback((clickedIndex: number) => {
    const { tracks } = browsingTracks;
    if (tracks.length === 0) return;
    const safeIndex = Math.max(0, Math.min(clickedIndex, tracks.length - 1));
    updateSlot(activeSlotId, s => ({ ...s, currentTime: audioRef.current?.currentTime || 0 }));
    loadPlaylistTracks(tracks);
    updateSlot('playlist', s => ({ ...s, currentTrackIndex: safeIndex }));
    setRestoreTime(0);
    switchTo('playlist');
    shouldAutoPlayRef.current = true;
    setIsPlaying(true);
  }, [browsingTracks, loadPlaylistTracks, updateSlot, activeSlotId, audioRef, setRestoreTime, switchTo, setIsPlaying, shouldAutoPlayRef]);

  // Playlist-only lyrics sliding window (size 3): prefetch the current track and
  // its two neighbours, and evict lyrics outside that window to bound memory.
  // Other slots are unaffected — online uses per-click enrichment, local/cloud
  // read lyrics from file metadata.
  useEffect(() => {
    const playlistTracksLocal = playlistTracks;
    const i = playlistCurrentIndex;
    if (i < 0 || playlistTracksLocal.length === 0) return;
    const lo = Math.max(0, i - 1);
    const hi = Math.min(playlistTracksLocal.length - 1, i + 1);

    // Prefetch the window's missing lyrics (current ± 1).
    for (let k = lo; k <= hi; k++) {
      const t = playlistTracksLocal[k];
      if (!t || !isProviderTrack(t) || hasWordTimedLyrics(t)) continue;
      const trackId = t.id;
      void enrichProviderTrackLyrics(t)
        .then(enrichedTrack => {
          if (!enrichedTrack) return;
          updatePlaylistTracks(prev => prev.map(x =>
            x.id === trackId ? applyEnrichedLyrics(x, enrichedTrack) : x
          ));
        })
        .catch(() => { /* lyrics are best-effort */ });
    }

    // Evict lyrics outside the window so only the current ± 1 stay cached.
    updatePlaylistTracks(prev => {
      const evictLo = Math.max(0, i - 1);
      const evictHi = Math.min(prev.length - 1, i + 1);
      let changed = false;
      const next = prev.map((t, k) => {
        if (k < evictLo || k > evictHi) {
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
  }, [playlistCurrentIndex, playlistTracks.length, enrichProviderTrackLyrics, updatePlaylistTracks]);

  return {
    handleTrackSelect,
    handleSearchNavigate,
    handleOnlineStreamPlay,
    playOnlineSong,
    openOnlinePlaylist,
    loadMoreBrowsingPlaylist,
    openOnlinePlaylistInLibrary,
    loadMorePlaylistInLibrary,
    browsingPlaylistLoadState,
    libraryPlaylistLoadState,
    browsingTracks,
    playBrowsingTrack,
  };
}
