/** Playback intents emitted by an operating-system lyrics surface. */
export type SystemLyricsAction = 'toggle-play' | 'previous' | 'next';

/** Minimal, serializable playback snapshot shared with native lyrics surfaces. */
export interface SystemLyricsState {
  trackId: string | null;
  title: string;
  artist: string;
  line: string;
  nextLine: string;
  isPlaying: boolean;
}

export const EMPTY_SYSTEM_LYRICS_STATE: SystemLyricsState = {
  trackId: null,
  title: '',
  artist: '',
  line: '',
  nextLine: '',
  isPlaying: false,
};
