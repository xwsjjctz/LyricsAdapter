import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { loadMacosPlayerSlidersBridge, type MacosPlayerSlidersBridge } from '../native/macosFocusGlassNative';
import { logger } from '../logger';
import { fail, ok, parsePayload } from './typedResult';

const presentation = z.object({
  x: z.number().finite().min(-4).max(4), y: z.number().finite().min(-4).max(4),
  width: z.number().finite().min(0).max(4), height: z.number().finite().min(0).max(4),
  opacity: z.number().finite().min(0).max(1),
});
const stateSchema = z.object({
  seek: presentation, volume: presentation, enabled: z.boolean(),
  currentTime: z.number().finite().min(0).max(604800), duration: z.number().finite().min(0).max(604800),
  level: z.number().finite().min(0).max(1),
  labels: z.object({ seek: z.string().min(1).max(128), volume: z.string().min(1).max(128) }),
});

export function registerPlayerSlidersHandlers(load = loadMacosPlayerSlidersBridge, platform = process.platform): void {
  let bridge: MacosPlayerSlidersBridge | null = null;
  let owner: WebContents | null = null;
  const stop = () => {
    owner?.removeListener('did-start-loading', stop); owner?.removeListener('destroyed', stop);
    owner = null; bridge?.stopPlayerSliders();
  };
  ipcMain.handle('ipc:playerSliders:start', event => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    if (owner && owner !== event.sender) return fail('Surface already owned');
    try {
      bridge ??= load(); if (!bridge) return ok(false);
      stop();
      const sender = event.sender;
      const started = bridge.startPlayerSliders(win.getNativeWindowHandle(), action => {
        if (owner === sender && !sender.isDestroyed()) sender.send('player-slider-action', action);
      });
      if (started) {
        owner = sender; sender.once('did-start-loading', stop); sender.once('destroyed', stop);
      }
      return ok(started);
    } catch (error) { stop(); logger.warn('[PlayerSliders] Using web sliders:', error); return ok(false); }
  });
  ipcMain.handle('ipc:playerSliders:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const state = parsePayload(stateSchema, payload); if (!state.ok) return state;
    try { bridge!.updatePlayerSliders(state.data); return ok(undefined); }
    catch (error) { stop(); logger.warn('[PlayerSliders] Update failed:', error); return fail('Native sliders unavailable'); }
  });
  ipcMain.handle('ipc:playerSliders:stop', event => {
    if (owner === event.sender && event.senderFrame === event.sender.mainFrame) stop();
    return ok(undefined);
  });
}
