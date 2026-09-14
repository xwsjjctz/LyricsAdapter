import { BrowserWindow, ipcMain, nativeImage, type WebContents } from 'electron';
import { z } from 'zod';
import { loadMacosFocusGlassBridge, type MacosFocusGlassBridge } from '../native/macosFocusGlassNative';
import { logger } from '../logger';
import { fail, ok, parsePayload } from './typedResult';
import { loadArtwork } from './playerControlbarHandlers';
import type { PlaybackSymbols } from '../../src/types/focusGlass';

const label = z.string().min(1).max(128);
export const focusGlassStateSchema = z.object({
  visible: z.boolean(), darkMode: z.boolean(), enabled: z.boolean(), isPlaying: z.boolean(),
  currentTime: z.number().finite().min(0).max(604800),
  duration: z.number().finite().min(0).max(604800),
  volume: z.number().finite().min(0).max(1),
  playbackMode: z.enum(['order', 'shuffle', 'repeat-one']),
  // Renderer placeholder; the main process overwrites it from the analyzed cover.
  backdropLuminance: z.number().finite().min(-1).max(1),
  presentation: z.object({
    x: z.number().finite().min(-4).max(4), y: z.number().finite().min(-4).max(4),
    width: z.number().finite().min(0).max(4), height: z.number().finite().min(0).max(4),
    opacity: z.number().finite().min(0).max(1),
  }),
  scale: z.number().finite().min(1).max(3),
  labels: z.object({ playPause: label, previous: label, next: label, seek: label, volume: label, mute: label, mode: label }),
});

const backdropSourceSchema = z.object({ source: z.string().max(8192).nullable() });

/** Per-cover average luminance cache (0..1, null = undecidable). */
const backdropLuminanceCache = new Map<string, number | null>();
const BACKDROP_LUMINANCE_CACHE_LIMIT = 8;

/** toBitmap channel order is platform-dependent (RGBA vs BGRA); the green
 *  channel sits in the middle either way, so weight the two side channels
 *  equally instead of guessing red from blue. */
function averageLuminance(data: Buffer): number | null {
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) return null;
  const small = image.resize({ width: 8, height: 8, quality: 'best' });
  const bitmap = small.toBitmap();
  const pixels = Math.floor(bitmap.length / 4);
  if (pixels <= 0) return null;
  let total = 0;
  for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
    const sides = bitmap[offset]! + bitmap[offset + 2]!;
    const green = bitmap[offset + 1]!;
    total += (0.1424 * sides + 0.7152 * green) / 255;
  }
  return total / pixels;
}

async function analyzeBackdropLuminance(source: string): Promise<number | null> {
  const cached = backdropLuminanceCache.get(source);
  if (cached !== undefined) return cached;
  let luminance: number | null = null;
  try {
    const data = await loadArtwork(source);
    luminance = data ? averageLuminance(data) : null;
  } catch (error) {
    logger.warn('[FocusGlass] Backdrop luminance unavailable:', error);
  }
  if (backdropLuminanceCache.size >= BACKDROP_LUMINANCE_CACHE_LIMIT) {
    backdropLuminanceCache.clear();
  }
  backdropLuminanceCache.set(source, luminance);
  return luminance;
}

/** A single main-window surface; callbacks report intents, never mutate playback. */
export function registerFocusGlassHandlers(load = loadMacosFocusGlassBridge, platform = process.platform): void {
  let bridge: MacosFocusGlassBridge | null = null;
  let owner: WebContents | null = null;
  let symbols: PlaybackSymbols | undefined;
  // Latest analyzed backdrop luminance for the active surface; -1 when unknown
  // (no cover yet, undecodable image, or analysis still in flight).
  let lastBackdropLuminance = -1;
  ipcMain.handle('ipc:focusGlass:playbackSymbols', event => {
    if (platform !== 'darwin') return ok({});
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    try {
      if (!symbols) {
        bridge ??= load();
        symbols = bridge?.getPlaybackSymbols?.() ?? {};
      }
      return ok(symbols);
    } catch (error) {
      logger.warn('[FocusGlass] System symbols unavailable; using existing icons:', error);
      symbols = {};
      return ok(symbols);
    }
  });
  const stop = () => {
    owner?.removeListener('did-start-loading', stop);
    owner?.removeListener('destroyed', stop);
    owner = null;
    lastBackdropLuminance = -1;
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

  // Runs regardless of the native surface so the CSS fallback controls receive
  // the same backdrop-derived contrast signal the native bar computes with.
  ipcMain.handle('ipc:focusGlass:backdrop', async (event, payload: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    const parsed = parsePayload(backdropSourceSchema, payload);
    if (!parsed.ok) return parsed;
    const luminance = parsed.data.source ? await analyzeBackdropLuminance(parsed.data.source) : null;
    lastBackdropLuminance = luminance ?? -1;
    if (event.sender.isDestroyed()) return ok(undefined);
    event.sender.send('focus-glass-backdrop', { luminance });
    return ok(undefined);
  });

  ipcMain.handle('ipc:focusGlass:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const parsed = parsePayload(focusGlassStateSchema, payload);
    if (!parsed.ok) return parsed;
    parsed.data.backdropLuminance = lastBackdropLuminance;
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
