import { createRequire } from 'node:module';
import type { FocusGlassAction, FocusGlassState, PlaybackSymbols } from '../../src/types/focusGlass';
import type { PlayerSlidersState, PlayerSliderAction } from '../../src/types/playerSliders';

const require = createRequire(import.meta.url);

export interface MacosPlayerSlidersBridge {
  startPlayerSliders(handle: Buffer, onAction: (action: PlayerSliderAction) => void): boolean;
  updatePlayerSliders(state: PlayerSlidersState): void;
  stopPlayerSliders(): void;
}
export function loadMacosPlayerSlidersBridge(): MacosPlayerSlidersBridge | null {
  if (process.platform !== 'darwin') return null;
  const native = require('@lyrics-adapter/macos-statusbar-native') as Partial<MacosPlayerSlidersBridge>;
  return typeof native.startPlayerSliders === 'function' && typeof native.updatePlayerSliders === 'function'
    && typeof native.stopPlayerSliders === 'function' ? native as MacosPlayerSlidersBridge : null;
}

export interface MacosFocusGlassBridge {
  getPlaybackSymbols?: () => PlaybackSymbols;
  startFocusGlass(handle: Buffer, onAction: (action: FocusGlassAction) => void): boolean;
  updateFocusGlass(state: FocusGlassState): void;
  stopFocusGlass(): void;
}

export function loadMacosFocusGlassBridge(): MacosFocusGlassBridge | null {
  if (process.platform !== 'darwin') return null;
  const native = require('@lyrics-adapter/macos-statusbar-native') as Partial<MacosFocusGlassBridge>;
  if (typeof native.startFocusGlass !== 'function'
    || typeof native.updateFocusGlass !== 'function'
    || typeof native.stopFocusGlass !== 'function') return null;
  return native as MacosFocusGlassBridge;
}
