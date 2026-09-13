import type { FocusGlassPresentation } from './focusGlass';

export interface PlayerControlbarState {
  presentation: FocusGlassPresentation;
  enabled: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  title: string;
  artist: string;
  labels: {
    focus: string;
    playPause: string;
    previous: string;
    next: string;
    seek: string;
    volume: string;
    mute: string;
    mode: string;
  };
}

export interface PlayerControlbarAction {
  type: 'focus' | 'toggle-play' | 'previous' | 'next' | 'mode' | 'mute' | 'seek' | 'volume';
  value: number;
}
