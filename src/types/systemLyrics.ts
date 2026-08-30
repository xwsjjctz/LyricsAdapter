/** Playback intents emitted by an operating-system lyrics surface. */
export type SystemLyricsAction = 'toggle-play' | 'previous' | 'next';

/** Fixed number of user-visible characters reserved by native lyric surfaces. */
export const SYSTEM_LYRICS_WINDOW_GRAPHEMES = 24;

/** Minimal, serializable playback snapshot shared with native lyrics surfaces. */
export interface SystemLyricsState {
  trackId: string | null;
  title: string;
  artist: string;
  line: string;
  nextLine: string;
  /** Zero-based grapheme currently being sung; null when no scrolling is needed. */
  lineCursor: number | null;
  isPlaying: boolean;
}

export const EMPTY_SYSTEM_LYRICS_STATE: SystemLyricsState = {
  trackId: null,
  title: '',
  artist: '',
  line: '',
  nextLine: '',
  lineCursor: null,
  isPlaying: false,
};
