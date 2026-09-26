import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import { loadMacosWallChromeBridge, type MacosWallChromeBridge } from '../native/macosFocusGlassNative';
import { loadArtwork } from './playerControlbarHandlers';
import { logger } from '../logger';
import { fail, ok, parsePayload } from './typedResult';

const presentation = z.object({
  x: z.number().finite().min(-4).max(4),
  y: z.number().finite().min(-4).max(4),
  width: z.number().finite().min(0).max(4),
  height: z.number().finite().min(0).max(4),
  opacity: z.number().finite().min(0).max(1),
});
const item = z.object({
  id: z.string().min(1).max(512),
  title: z.string().max(512),
  count: z.number().int().min(0).max(10_000_000),
  icon: z.enum(['local', 'history', 'playlist']),
  checked: z.boolean(),
  imageUrl: z.string().max(4096).nullable(),
});
export const wallChromeStateSchema = z.object({
  presentation,
  darkMode: z.boolean(),
  title: z.string().max(512),
  labels: z.object({ back: z.string().min(1).max(256), source: z.string().min(1).max(512) }),
  sections: z.array(z.object({ title: z.string().max(128), items: z.array(item).max(500) })).max(4),
});

const ARTWORK_PROTOCOLS = new Set(['https:', 'http:', 'cover:']);
const MAX_CACHED_ARTWORK = 300;

const isFetchableArtwork = (url: string): boolean => {
  try {
    return ARTWORK_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

/** Owns the native poster-wall chrome for one renderer; navigation stays in React. */
export function registerWallChromeHandlers(
  load = loadMacosWallChromeBridge,
  platform = process.platform,
): void {
  let bridge: MacosWallChromeBridge | null = null;
  let owner: WebContents | null = null;
  // Artwork resolved (or in flight) for the current surface, keyed by URL.
  const artwork = new Map<string, Promise<Buffer | null>>();

  const stop = () => {
    owner?.removeListener('did-start-loading', stop);
    owner?.removeListener('destroyed', stop);
    owner = null;
    artwork.clear();
    bridge?.stopWallChrome();
  };

  const deliverArtwork = (url: string) => {
    if (artwork.has(url) || artwork.size >= MAX_CACHED_ARTWORK || !isFetchableArtwork(url)) return;
    const surface = owner;
    const pending = loadArtwork(url).catch(error => {
      logger.warn('[WallChrome] Playlist artwork unavailable:', error);
      return null;
    });
    artwork.set(url, pending);
    void pending.then(data => {
      if (data && owner === surface) bridge?.setWallChromeArtwork(url, data);
    });
  };

  ipcMain.handle('ipc:wallChrome:start', event => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    if (owner && owner !== event.sender) return fail('Surface already owned');
    try {
      bridge ??= load();
      if (!bridge) return ok(false);
      stop();
      const sender = event.sender;
      const started = bridge.startWallChrome(win.getNativeWindowHandle(), action => {
        if (owner === sender && !sender.isDestroyed()) sender.send('wall-chrome-action', action);
      });
      if (started) {
        owner = sender;
        sender.once('did-start-loading', stop);
        sender.once('destroyed', stop);
      }
      return ok(started);
    } catch (error) {
      stop();
      logger.warn('[WallChrome] Native surface unavailable; using web chrome:', error);
      return ok(false);
    }
  });

  ipcMain.handle('ipc:wallChrome:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const state = parsePayload(wallChromeStateSchema, payload);
    if (!state.ok) return state;
    try {
      bridge!.updateWallChrome(state.data);
      for (const section of state.data.sections) {
        for (const entry of section.items) if (entry.imageUrl) deliverArtwork(entry.imageUrl);
      }
      return ok(undefined);
    } catch (error) {
      stop();
      logger.warn('[WallChrome] Update failed:', error);
      return fail('Native wall chrome unavailable');
    }
  });

  ipcMain.handle('ipc:wallChrome:stop', event => {
    if (owner === event.sender && event.senderFrame === event.sender.mainFrame) stop();
    return ok(undefined);
  });
}
