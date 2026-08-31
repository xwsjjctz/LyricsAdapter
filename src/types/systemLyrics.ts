/** Playback intents emitted by an operating-system lyrics surface. */
export type SystemLyricsAction = 'toggle-play' | 'previous' | 'next';

/** Fixed number of user-visible characters reserved by system lyrics surfaces. */
export const SYSTEM_LYRICS_WINDOW_GRAPHEMES = 24;

/** Minimal, serializable playback snapshot shared with system lyrics surfaces. */
export interface SystemLyricsState {
  trackId: string | null;
  coverUrl: string;
  title: string;
  artist: string;
  line: string;
  nextLine: string;
  /** Zero-based grapheme currently being sung; null when no scrolling is needed. */
  lineCursor: number | null;
  /** Number of graphemes fully sung in the current line; null without timed lyrics. */
  lineProgress: number | null;
  isPlaying: boolean;
}

export const EMPTY_SYSTEM_LYRICS_STATE: SystemLyricsState = {
  trackId: null,
  coverUrl: '',
  title: '',
  artist: '',
  line: '',
  nextLine: '',
  lineCursor: null,
  lineProgress: null,
  isPlaying: false,
};
