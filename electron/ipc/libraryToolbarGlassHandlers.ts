import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import {
  loadMacosLibraryToolbarGlassBridge,
  type MacosLibraryToolbarGlassBridge,
} from '../native/macosFocusGlassNative';
import { logger } from '../logger';
import { fail, ok, parsePayload } from './typedResult';

const presentation = z.object({
  x: z.number().finite().min(-4).max(4),
  y: z.number().finite().min(-4).max(4),
  width: z.number().finite().min(0).max(4),
  height: z.number().finite().min(0).max(4),
  opacity: z.number().finite().min(0).max(1),
});
const button = z.object({
  presentation,
  symbol: z.enum(['edit', 'check', 'refresh', 'upload-file', 'cloud-upload']),
  enabled: z.boolean(),
  emphasized: z.boolean(),
  tintColor: z.string().regex(/^$|^#[0-9a-fA-F]{6}$/),
  label: z.string().min(1).max(128),
});
export const libraryToolbarGlassStateSchema = z.object({
  darkMode: z.boolean(),
  primary: button,
  secondary: button,
});

/** Owns the two AppKit glass buttons beside the library search field. */
export function registerLibraryToolbarGlassHandlers(
  load = loadMacosLibraryToolbarGlassBridge,
  platform = process.platform,
): void {
  let bridge: MacosLibraryToolbarGlassBridge | null = null;
  let owner: WebContents | null = null;
  const stop = () => {
    owner?.removeListener('did-start-loading', stop);
    owner?.removeListener('destroyed', stop);
    owner = null;
    bridge?.stopLibraryToolbarGlass();
  };

  ipcMain.handle('ipc:libraryToolbarGlass:start', event => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    if (owner && owner !== event.sender) return fail('Surface already owned');
    try {
      bridge ??= load();
      if (!bridge) return ok(false);
      stop();
      const sender = event.sender;
      const started = bridge.startLibraryToolbarGlass(win.getNativeWindowHandle(), action => {
        if (owner === sender && !sender.isDestroyed()) sender.send('library-toolbar-glass-action', action);
      });
      if (started) {
        owner = sender;
        sender.once('did-start-loading', stop);
        sender.once('destroyed', stop);
      }
      return ok(started);
    } catch (error) {
      stop();
      logger.warn('[LibraryToolbarGlass] Native buttons unavailable; using web buttons:', error);
      return ok(false);
    }
  });

  ipcMain.handle('ipc:libraryToolbarGlass:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const state = parsePayload(libraryToolbarGlassStateSchema, payload);
    if (!state.ok) return state;
    try {
      bridge!.updateLibraryToolbarGlass(state.data);
      return ok(undefined);
    } catch (error) {
      stop();
      logger.warn('[LibraryToolbarGlass] Native button update failed:', error);
      return fail('Native toolbar buttons unavailable');
    }
  });

  ipcMain.handle('ipc:libraryToolbarGlass:stop', event => {
    if (owner === event.sender && event.senderFrame === event.sender.mainFrame) stop();
    return ok(undefined);
  });
}
