import { createRequire } from 'node:module';
import type { FocusGlassAction, FocusGlassState, PlaybackSymbols } from '../../src/types/focusGlass';
import type { PlayerControlbarState, PlayerControlbarAction } from '../../src/types/playerControlbar';
import type { LibraryToolbarGlassAction, LibraryToolbarGlassState } from '../../src/types/libraryToolbarGlass';

const require = createRequire(import.meta.url);

export interface MacosLibraryToolbarGlassBridge {
  startLibraryToolbarGlass(handle: Buffer, onAction: (action: LibraryToolbarGlassAction) => void): boolean;
  updateLibraryToolbarGlass(state: LibraryToolbarGlassState): void;
  stopLibraryToolbarGlass(): void;
}

export function loadMacosLibraryToolbarGlassBridge(): MacosLibraryToolbarGlassBridge | null {
  if (process.platform !== 'darwin') return null;
  const native = require('@lyrics-adapter/macos-statusbar-native') as Partial<MacosLibraryToolbarGlassBridge>;
  return typeof native.startLibraryToolbarGlass === 'function'
    && typeof native.updateLibraryToolbarGlass === 'function'
    && typeof native.stopLibraryToolbarGlass === 'function'
    ? native as MacosLibraryToolbarGlassBridge : null;
}

export interface MacosPlayerControlbarBridge {
  startPlayerControlbar(handle: Buffer, onAction: (action: PlayerControlbarAction) => void): boolean;
  updatePlayerControlbar(state: PlayerControlbarState): void;
  updatePlayerControlbarArtwork(data: Buffer | null): void;
  stopPlayerControlbar(): void;
}
export function loadMacosPlayerControlbarBridge(): MacosPlayerControlbarBridge | null {
  if (process.platform !== 'darwin') return null;
  const native = require('@lyrics-adapter/macos-statusbar-native') as Partial<MacosPlayerControlbarBridge>;
  return typeof native.startPlayerControlbar === 'function'
    && typeof native.updatePlayerControlbar === 'function'
    && typeof native.updatePlayerControlbarArtwork === 'function'
    && typeof native.stopPlayerControlbar === 'function'
    ? native as MacosPlayerControlbarBridge : null;
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
