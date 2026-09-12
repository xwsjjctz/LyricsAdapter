export type PlaybackSymbol = 'skip_previous' | 'play_arrow' | 'pause' | 'skip_next'
  | 'repeat' | 'shuffle' | 'repeat_one' | 'volume_off' | 'volume_up' | 'open_in_full';
export type PlaybackSymbols = Partial<Record<PlaybackSymbol, string>>;

/** Rectangle normalized to the renderer viewport; y starts at the top. */
export interface FocusGlassPresentation {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export interface FocusGlassState {
  visible: boolean;
  presentation: FocusGlassPresentation;
  enabled: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  scale: number;
  labels: {
    playPause: string;
    previous: string;
    next: string;
    seek: string;
    volume: string;
    mute: string;
    mode: string;
  };
}

export type FocusGlassAction = {
  type: 'toggle-play' | 'previous' | 'next' | 'mode' | 'mute' | 'seek' | 'volume' | 'hover';
  value: number;
};
