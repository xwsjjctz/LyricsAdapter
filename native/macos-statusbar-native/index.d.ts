export type StatusbarAction = 'previous' | 'toggle-play' | 'next';

export interface StartStatusItemOptions {
  width: number;
  controlStripWidth: number;
}

export interface StatusItemUpdate {
  text: string;
  highlightedGraphemes: number;
  isPlaying: boolean;
}

export function getApiVersion(): number;
export function startStatusItem(
  options: StartStatusItemOptions,
  onAction: (action: StatusbarAction) => void,
): boolean;
export function updateStatusItem(update: StatusItemUpdate): void;
export function stopStatusItem(): void;

/** Main-thread-only FocusMode surface. Returns false before macOS 26. */
export function startFocusGlass(
  windowHandle: Buffer,
  onAction: (action: { type: 'toggle-play' | 'previous' | 'next' | 'mode' | 'mute' | 'seek' | 'volume' | 'hover'; value: number }) => void,
): boolean;
export function updateFocusGlass(state: {
  visible: boolean;
  presentation: { x: number; y: number; width: number; height: number; opacity: number };
  enabled: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  scale: number;
  labels: { playPause: string; previous: string; next: string; seek: string; volume: string; mute: string; mode: string };
}): void;
export function stopFocusGlass(): void;
/** PNG alpha masks rendered from the installed SF Symbols. */
export function getPlaybackSymbols(): Record<string, string>;
/** Main-thread-only macOS 26 control bar surface. */
export function startPlayerControlbar(handle: Buffer, onAction: (action: {
  type: 'focus' | 'toggle-play' | 'previous' | 'next' | 'mode' | 'mute' | 'seek' | 'volume'; value: number;
}) => void): boolean;
export function updatePlayerControlbar(state: {
  presentation: { x: number; y: number; width: number; height: number; opacity: number };
  currentTime: number; duration: number; volume: number; enabled: boolean; isPlaying: boolean;
  playbackMode: 'order' | 'shuffle' | 'repeat-one'; title: string; artist: string;
  labels: { focus: string; playPause: string; previous: string; next: string; seek: string; volume: string; mute: string; mode: string };
}): void;
export function updatePlayerControlbarArtwork(data: Buffer | null): void;
export function stopPlayerControlbar(): void;
/** Main-thread-only macOS 26 command palette surface. */
export function startNativePalette(handle: Buffer, onAction: (action: {
  type: 'query' | 'move' | 'hover' | 'activate' | 'tab' | 'cycle-mode' | 'mode' | 'escape' | 'backspace' | 'shortcut';
  value: number; text: string;
}) => void): boolean;
export function updateNativePalette(state: {
  open: boolean; darkMode: boolean; label: string; modes: string[]; modeIndex: number; hint: string;
  placeholder: string; searchSymbol: string; query: string; trail: string; loading: boolean; empty: string; selected: number;
  rows: Array<{ section: string; title: string; subtitle: string; detail: string; shortcut: string; symbol: string; cover: string | null; nested: boolean }>;
}): void;
export function setNativePaletteCover(url: string, data: Buffer): void;
export function stopNativePalette(): void;
