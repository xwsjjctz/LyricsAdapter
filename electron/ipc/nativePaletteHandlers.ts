import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import {
  loadMacosNativePaletteBridge,
  type MacosNativePaletteBridge,
} from '../native/macosFocusGlassNative';
import { logger } from '../logger';
import { createCoverQueue } from './coverQueue';
import { loadArtwork } from './playerControlbarHandlers';
import { fail, ok, parsePayload } from './typedResult';

const MAX_ROWS = 200;

const text = z.string().max(2048);
const row = z.object({
  section: text,
  title: text,
  subtitle: text,
  detail: text,
  shortcut: z.string().max(64),
  symbol: z.string().min(1).max(128),
  cover: z.string().max(8192).nullable(),
  nested: z.boolean(),
});
export const nativePaletteStateSchema = z.object({
  open: z.boolean(),
  darkMode: z.boolean(),
  label: z.string().min(1).max(256),
  modes: z.array(z.string().min(1).max(64)).min(1).max(4),
  modeIndex: z.number().int().min(0).max(3),
  hint: z.string().max(256),
  placeholder: z.string().max(256),
  searchSymbol: z.string().min(1).max(128),
  query: text,
  trail: text,
  loading: z.boolean(),
  empty: z.string().max(256),
  selected: z.number().int().min(-1).max(MAX_ROWS),
  rows: z.array(row).max(MAX_ROWS),
}).refine(state => state.modeIndex < state.modes.length, { message: 'modeIndex out of range' });

/** Owns one native macOS command palette while its state stays in React. */
export function registerNativePaletteHandlers(
  load = loadMacosNativePaletteBridge,
  platform = process.platform,
  resolveCover = loadArtwork,
): void {
  let bridge: MacosNativePaletteBridge | null = null;
  let owner: WebContents | null = null;
  const covers = createCoverQueue(resolveCover, (url, data) => bridge?.setNativePaletteCover(url, data), 'NativePalette');

  const stop = () => {
    covers.reset();
    owner?.removeListener('did-start-loading', stop);
    owner?.removeListener('destroyed', stop);
    owner = null;
    bridge?.stopNativePalette();
  };

  ipcMain.handle('ipc:nativePalette:start', event => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    if (owner && owner !== event.sender) return fail('Surface already owned');
    try {
      bridge ??= load();
      if (!bridge) return ok(false);
      stop();
      const sender = event.sender;
      const started = bridge.startNativePalette(win.getNativeWindowHandle(), action => {
        if (owner === sender && !sender.isDestroyed()) sender.send('native-palette-action', action);
      });
      if (started) {
        owner = sender;
        sender.once('did-start-loading', stop);
        sender.once('destroyed', stop);
      }
      return ok(started);
    } catch (error) {
      stop();
      logger.warn('[NativePalette] Native surface unavailable; using web palette:', error);
      return ok(false);
    }
  });

  ipcMain.handle('ipc:nativePalette:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const state = parsePayload(nativePaletteStateSchema, payload);
    if (!state.ok) return state;
    try {
      bridge!.updateNativePalette(state.data);
      if (state.data.open) covers.request(state.data.rows.flatMap(entry => (entry.cover ? [entry.cover] : [])));
      return ok(undefined);
    } catch (error) {
      stop();
      logger.warn('[NativePalette] Update failed:', error);
      return fail('Native palette unavailable');
    }
  });

  ipcMain.handle('ipc:nativePalette:stop', event => {
    if (owner === event.sender && event.senderFrame === event.sender.mainFrame) stop();
    return ok(undefined);
  });
}
