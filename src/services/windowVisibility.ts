import { getDesktopAPI } from './desktopAdapter';

/**
 * Whether the main window is on screen (not minimized or hidden). The main
 * process reports it because macOS keeps background throttling off for the
 * status-item lyrics, so the page itself always looks visible. While hidden,
 * the root carries `data-window-hidden`, which pauses CSS animations.
 */
let visible = true;
let bridgeStarted = false;
const listeners = new Set<() => void>();

function applyVisibility(next: boolean): void {
  if (next === visible) return;
  visible = next;
  document.documentElement.toggleAttribute('data-window-hidden', !next);
  listeners.forEach(listener => listener());
}

export function subscribeWindowVisibility(listener: () => void): () => void {
  listeners.add(listener);
  if (!bridgeStarted) {
    bridgeStarted = true;
    getDesktopAPI()?.onWindowVisibilityChange?.(applyVisibility);
  }
  return () => { listeners.delete(listener); };
}

export function isWindowVisible(): boolean {
  return visible;
}
