import { screen, type BrowserWindow, type Size } from 'electron';
import { z } from 'zod';
import { settingsStore } from './settingsStore';
import { logger } from '../logger';

export const WINDOW_STATE_KEY = 'la_window_state';
export const WINDOW_MIN_SIZE = { width: 360, height: 600 } as const;
export const WINDOW_PRESETS = {
  landscape: { width: 1200, height: 800 },
  portrait: { width: 385, height: 800 },
} as const;
export type WindowPreset = keyof typeof WINDOW_PRESETS;

const stateSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean().default(false),
});

/** Keep restored/preset sizes usable when the available display has changed. */
export function fitWindowSize(size: Size, available: Size): Size {
  return {
    width: Math.min(available.width, Math.max(WINDOW_MIN_SIZE.width, size.width)),
    height: Math.min(available.height, Math.max(WINDOW_MIN_SIZE.height, size.height)),
  };
}

export function getInitialWindowState() {
  const available = screen.getPrimaryDisplay().workAreaSize;
  let state = { ...WINDOW_PRESETS.landscape, maximized: false } as z.infer<typeof stateSchema>;
  const raw = settingsStore.get(WINDOW_STATE_KEY);
  if (raw) {
    try {
      state = stateSchema.parse(JSON.parse(raw));
    } catch (error) {
      logger.warn('[WindowState] Ignoring invalid saved window size:', error);
    }
  }
  return {
    ...fitWindowSize(state, available),
    minWidth: Math.min(WINDOW_MIN_SIZE.width, available.width),
    minHeight: Math.min(WINDOW_MIN_SIZE.height, available.height),
    maximized: state.maximized,
  };
}

/** Debounce live resizing, then synchronously flush before the database closes. */
export function rememberWindowState(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSaved = settingsStore.get(WINDOW_STATE_KEY);
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const save = () => {
    clear();
    if (window.isDestroyed()) return;
    // Fullscreen/maximized display bounds must not replace the user's normal size.
    const { width, height } = window.getNormalBounds();
    const state = stateSchema.safeParse({ width, height, maximized: window.isMaximized() });
    if (!state.success) return;
    const serialized = JSON.stringify(state.data);
    if (serialized !== lastSaved && settingsStore.set(WINDOW_STATE_KEY, serialized)) lastSaved = serialized;
  };
  const schedule = () => { clear(); timer = setTimeout(save, 250); };
  window.on('resize', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('close', save);
  window.once('closed', clear);
}

const pendingPresets = new WeakMap<BrowserWindow, WindowPreset>();

/** Apply the latest choice after native fullscreen/zoom/restore has completed. */
export function applyWindowPreset(window: BrowserWindow, preset: WindowPreset): void {
  if (window.isDestroyed()) return;
  const pending = pendingPresets.has(window);
  pendingPresets.set(window, preset);
  if (pending) return;
  const resize = () => {
    const chosen = pendingPresets.get(window);
    pendingPresets.delete(window);
    if (!chosen || window.isDestroyed()) return;
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const size = fitWindowSize(WINDOW_PRESETS[chosen], area);
    const center = (start: number, oldSize: number, newSize: number, limit: number, length: number) =>
      Math.round(Math.max(limit, Math.min(start + (oldSize - newSize) / 2, limit + length - newSize)));
    window.setMinimumSize(Math.min(WINDOW_MIN_SIZE.width, area.width), Math.min(WINDOW_MIN_SIZE.height, area.height));
    window.setBounds({
      ...size,
      x: center(bounds.x, bounds.width, size.width, area.x, area.width),
      y: center(bounds.y, bounds.height, size.height, area.y, area.height),
    });
    window.show();
    window.focus();
  };
  const unmaximize = () => {
    if (window.isDestroyed()) { pendingPresets.delete(window); return; }
    if (window.isMaximized()) { window.once('unmaximize', resize); window.unmaximize(); }
    else resize();
  };
  const restore = () => {
    if (window.isDestroyed()) { pendingPresets.delete(window); return; }
    if (window.isMinimized()) { window.once('restore', unmaximize); window.restore(); }
    else unmaximize();
  };
  if (window.isFullScreen()) { window.once('leave-full-screen', restore); window.setFullScreen(false); }
  else restore();
}
