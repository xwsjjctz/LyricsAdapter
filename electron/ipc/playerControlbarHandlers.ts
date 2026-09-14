import { BrowserWindow, ipcMain, nativeImage, net, type WebContents } from 'electron';
import { z } from 'zod';
import {
  loadMacosPlayerControlbarBridge,
  type MacosPlayerControlbarBridge,
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
const label = z.string().min(1).max(128);
export const playerControlbarStateSchema = z.object({
  presentation,
  darkMode: z.boolean(),
  enabled: z.boolean(),
  isPlaying: z.boolean(),
  currentTime: z.number().finite().min(0).max(604800),
  duration: z.number().finite().min(0).max(604800),
  volume: z.number().finite().min(0).max(1),
  playbackMode: z.enum(['order', 'shuffle', 'repeat-one']),
  title: z.string().max(1024),
  artist: z.string().max(1024),
  labels: z.object({
    focus: label,
    playPause: label,
    previous: label,
    next: label,
    seek: label,
    volume: label,
    mute: label,
    mode: label,
  }),
});

const artworkSchema = z.string().max(8192).nullable();
const ALLOWED_ARTWORK_PROTOCOLS = new Set(['cover:', 'https:', 'http:', 'data:']);
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;

/** Fetches and decodes an artwork URL into a compact PNG; null when unavailable. */
export async function loadArtwork(source: string): Promise<Buffer | null> {
  const url = new URL(source);
  if (!ALLOWED_ARTWORK_PROTOCOLS.has(url.protocol)) throw new Error('Unsupported artwork protocol');
  const response = await net.fetch(source);
  if (!response.ok) return null;
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (declaredSize > MAX_ARTWORK_BYTES) throw new Error('Artwork is too large');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength > MAX_ARTWORK_BYTES) throw new Error('Artwork is too large');
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) return null;
  const resized = image.resize({ width: 96, height: 96, quality: 'best' });
  return resized.toPNG();
}

/** Owns one native, region-scoped macOS control bar while playback stays in React. */
export function registerPlayerControlbarHandlers(
  load = loadMacosPlayerControlbarBridge,
  platform = process.platform,
): void {
  let bridge: MacosPlayerControlbarBridge | null = null;
  let owner: WebContents | null = null;
  let artworkRevision = 0;
  const stop = () => {
    artworkRevision++;
    owner?.removeListener('did-start-loading', stop);
    owner?.removeListener('destroyed', stop);
    owner = null;
    bridge?.stopPlayerControlbar();
  };

  ipcMain.handle('ipc:playerControlbar:start', event => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    if (owner && owner !== event.sender) return fail('Surface already owned');
    try {
      bridge ??= load();
      if (!bridge) return ok(false);
      stop();
      const sender = event.sender;
      const started = bridge.startPlayerControlbar(win.getNativeWindowHandle(), action => {
        if (owner === sender && !sender.isDestroyed()) sender.send('player-controlbar-action', action);
      });
      if (started) {
        owner = sender;
        sender.once('did-start-loading', stop);
        sender.once('destroyed', stop);
      }
      return ok(started);
    } catch (error) {
      stop();
      logger.warn('[PlayerControlbar] Native surface unavailable; using web controls:', error);
      return ok(false);
    }
  });

  ipcMain.handle('ipc:playerControlbar:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const state = parsePayload(playerControlbarStateSchema, payload);
    if (!state.ok) return state;
    try {
      bridge!.updatePlayerControlbar(state.data);
      return ok(undefined);
    } catch (error) {
      stop();
      logger.warn('[PlayerControlbar] Update failed:', error);
      return fail('Native control bar unavailable');
    }
  });

  ipcMain.handle('ipc:playerControlbar:artwork', async (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const source = parsePayload(artworkSchema, payload);
    if (!source.ok) return source;
    const sender = event.sender;
    const revision = ++artworkRevision;
    try {
      const data = source.data ? await loadArtwork(source.data) : null;
      if (owner !== sender || revision !== artworkRevision) return ok(undefined);
      bridge!.updatePlayerControlbarArtwork(data);
      return ok(undefined);
    } catch (error) {
      if (owner === sender && revision === artworkRevision) bridge?.updatePlayerControlbarArtwork(null);
      logger.warn('[PlayerControlbar] Artwork unavailable:', error);
      return ok(undefined);
    }
  });

  ipcMain.handle('ipc:playerControlbar:stop', event => {
    if (owner === event.sender && event.senderFrame === event.sender.mainFrame) stop();
    return ok(undefined);
  });
}
