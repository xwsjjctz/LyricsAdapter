import { createRequire } from 'node:module';
import type { FocusGlassAction, FocusGlassState, PlaybackSymbols } from '../../src/types/focusGlass';
import type { PlayerControlbarState, PlayerControlbarAction } from '../../src/types/playerControlbar';
import type { NativePaletteAction, NativePaletteState } from '../../src/types/nativePalette';
import type { PlaylistSwitcherAction, PlaylistSwitcherState } from '../../src/types/playlistSwitcher';

const require = createRequire(import.meta.url);

interface MacosSettingsGlassBridge { attachSettingsGlass(handle: Buffer): boolean }
export function loadMacosSettingsGlassBridge(): MacosSettingsGlassBridge | null {
  if (process.platform !== 'darwin') return null;
  const native = require('@lyrics-adapter/macos-statusbar-native') as Partial<MacosSettingsGlassBridge>;
  return typeof native.attachSettingsGlass === 'function' ? native as MacosSettingsGlassBridge : null;
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

export interface MacosNativePaletteBridge {
  startNativePalette(handle: Buffer, onAction: (action: NativePaletteAction) => void): boolean;
  updateNativePalette(state: NativePaletteState): void;
  setNativePaletteCover(url: string, data: Buffer): void;
  stopNativePalette(): void;
}

export function loadMacosNativePaletteBridge(): MacosNativePaletteBridge | null {
  if (process.platform !== 'darwin') return null;
  const native = require('@lyrics-adapter/macos-statusbar-native') as Partial<MacosNativePaletteBridge>;
  return typeof native.startNativePalette === 'function'
    && typeof native.updateNativePalette === 'function'
    && typeof native.setNativePaletteCover === 'function'
    && typeof native.stopNativePalette === 'function'
    ? native as MacosNativePaletteBridge : null;
}

export interface MacosPlaylistSwitcherBridge {
  startPlaylistSwitcher(handle: Buffer, onAction: (action: PlaylistSwitcherAction) => void): boolean;
  updatePlaylistSwitcher(state: PlaylistSwitcherState): void;
  setPlaylistSwitcherCover(url: string, data: Buffer): void;
  stopPlaylistSwitcher(): void;
}

export function loadMacosPlaylistSwitcherBridge(): MacosPlaylistSwitcherBridge | null {
  if (process.platform !== 'darwin') return null;
  const native = require('@lyrics-adapter/macos-statusbar-native') as Partial<MacosPlaylistSwitcherBridge>;
  return typeof native.startPlaylistSwitcher === 'function'
    && typeof native.updatePlaylistSwitcher === 'function'
    && typeof native.setPlaylistSwitcherCover === 'function'
    && typeof native.stopPlaylistSwitcher === 'function'
    ? native as MacosPlaylistSwitcherBridge : null;
}
