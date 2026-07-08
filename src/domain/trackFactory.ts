import type { Track } from '../types';
import type { OnlineSong, OnlineSource } from '../services/onlineMusicProvider';

/**
 * Convert an {@link OnlineSong} (QQ / NetEase provider shape) into the unified
 * {@link Track} model used everywhere downstream of playback.
 *
 * This is the **single** place that knows how an online song maps to a Track.
 * Previously the same construction was duplicated in 4 locations
 * (PlaylistsView, AppWorkspace.openOnlinePlaylist, usePlayerController for
 * stream-play and play-playlist), and they had already started to diverge
 * (coverUrl handling). Funnel all online→Track creation through here so a
 * provider field change only touches one spot.
 *
 * Identity convention: `online-${source}-${songmid}` — must stay in sync with
 * the id-matching logic in PlaylistsView and the online-slot LRU keying.
 */
export function onlineSongToTrack(song: OnlineSong, source: OnlineSource): Track {
  return {
    id: `online-${source}-${song.songmid}`,
    title: song.songname,
    artist: song.singer?.map(a => a.name).join(' & ') || 'Unknown Artist',
    album: song.albumname || 'Unknown Album',
    duration: song.interval || 0,
    coverUrl: song.coverUrl,
    audioUrl: '',
    source,
    songmid: song.songmid,
  };
}
