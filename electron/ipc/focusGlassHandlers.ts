import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { loadMacosFocusGlassBridge, type MacosFocusGlassBridge } from '../native/macosFocusGlassNative';
import { logger } from '../logger';
import { fail, ok, parsePayload } from './typedResult';

const label = z.string().min(1).max(128);
export const focusGlassStateSchema = z.object({
  visible: z.boolean(), enabled: z.boolean(), isPlaying: z.boolean(),
  currentTime: z.number().finite().min(0).max(604800),
  duration: z.number().finite().min(0).max(604800),
  volume: z.number().finite().min(0).max(1),
  playbackMode: z.enum(['order', 'shuffle', 'repeat-one']),
  presentation: z.object({
    x: z.number().finite().min(-4).max(4), y: z.number().finite().min(-4).max(4),
    width: z.number().finite().min(0).max(4), height: z.number().finite().min(0).max(4),
    opacity: z.number().finite().min(0).max(1),
  }),
  scale: z.number().finite().min(1).max(3),
  labels: z.object({ playPause: label, previous: label, next: label, seek: label, volume: label, mute: label, mode: label }),
});

/** A single main-window surface; callbacks report intents, never mutate playback. */
export function registerFocusGlassHandlers(load = loadMacosFocusGlassBridge, platform = process.platform): void {
  let bridge: MacosFocusGlassBridge | null = null;
  let owner: WebContents | null = null;
  const stop = () => {
    owner?.removeListener('did-start-loading', stop);
    owner?.removeListener('destroyed', stop);
    owner = null;
    bridge?.stopFocusGlass();
  };

  ipcMain.handle('ipc:focusGlass:start', event => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    try {
      if (owner && owner !== event.sender) return fail('Surface already owned');
      bridge ??= load();
      if (!bridge) return ok(false);
      stop();
      const sender = event.sender;
      const started = bridge.startFocusGlass(win.getNativeWindowHandle(), action => {
        if (owner === sender && !sender.isDestroyed()) sender.send('focus-glass-action', action);
      });
      if (started) {
        owner = sender;
        sender.once('did-start-loading', stop);
        sender.once('destroyed', stop);
      }
      return ok(started);
    } catch (error) {
      stop();
      logger.warn('[FocusGlass] Native surface unavailable; using web controls:', error);
      return ok(false);
    }
  });

  ipcMain.handle('ipc:focusGlass:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const parsed = parsePayload(focusGlassStateSchema, payload);
    if (!parsed.ok) return parsed;
    try {
      bridge!.updateFocusGlass(parsed.data);
      return ok(undefined);
    } catch (error) {
      stop();
      logger.warn('[FocusGlass] Update failed; releasing native surface:', error);
      return fail('Native surface update failed');
    }
  });
  ipcMain.handle('ipc:focusGlass:stop', event => {
    if (owner === event.sender && event.senderFrame === event.sender.mainFrame) stop();
    return ok(undefined);
  });
}
