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
