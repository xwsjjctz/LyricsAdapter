import type { FocusGlassPresentation } from './focusGlass';

export interface PlayerSlidersState {
  seek: FocusGlassPresentation;
  volume: FocusGlassPresentation;
  currentTime: number;
  duration: number;
  level: number;
  enabled: boolean;
  labels: { seek: string; volume: string };
}
export interface PlayerSliderAction { type: 'seek' | 'volume' | 'volume-presence'; value: number }
