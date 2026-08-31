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
