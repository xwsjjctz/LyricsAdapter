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
