export type PlaybackSymbol = 'skip_previous' | 'play_arrow' | 'pause' | 'skip_next'
  | 'repeat' | 'shuffle' | 'repeat_one' | 'volume_off' | 'volume_up' | 'open_in_full'
  | 'fast_rewind' | 'fast_forward' | 'volume_down' | 'translate';
export type PlaybackSymbols = Partial<Record<PlaybackSymbol, string>>;

/** Rectangle normalized to the renderer viewport; y starts at the top. */
export interface FocusGlassPresentation {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

/** Plugin lyric translation; `unavailable` hides the button. */
export type FocusGlassTranslation = 'unavailable' | 'idle' | 'translating' | 'translated' | 'error';

export interface FocusGlassState {
  visible: boolean;
  presentation: FocusGlassPresentation;
  /** Theme dark mode; the native surface prefers backdropLuminance when known. */
  darkMode: boolean;
  /** Average luminance of the blurred FocusMode backdrop, 0..1; negative when unknown. */
  backdropLuminance: number;
  enabled: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  translation: FocusGlassTranslation;
  scale: number;
  labels: {
    playPause: string;
    previous: string;
    next: string;
    seek: string;
    volume: string;
    mute: string;
    mode: string;
    translate: string;
  };
}

export type FocusGlassAction = {
  type: 'toggle-play' | 'previous' | 'next' | 'mode' | 'mute' | 'seek' | 'volume' | 'hover' | 'translate';
  value: number;
};
