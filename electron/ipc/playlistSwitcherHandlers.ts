import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import {
  loadMacosPlaylistSwitcherBridge,
  type MacosPlaylistSwitcherBridge,
} from '../native/macosFocusGlassNative';
import { PLAYLIST_SWITCHER_MAX_CARDS } from '../../src/types/playlistSwitcher';
import { logger } from '../logger';
import { createCoverQueue } from './coverQueue';
import { loadArtwork } from './playerControlbarHandlers';
import { fail, ok, parsePayload } from './typedResult';

/** Card artwork is drawn at up to 96 pt, so decode for a 2x display. */
const COVER_SIZE = 192;

const text = z.string().max(2048);
const card = z.object({
  name: text,
  detail: text,
  symbol: z.string().min(1).max(128),
  cover: z.string().max(8192).nullable(),
});
export const playlistSwitcherStateSchema = z.object({
  open: z.boolean(),
  darkMode: z.boolean(),
  label: z.string().min(1).max(256),
  hint: z.string().max(256),
  selected: z.number().int().min(-1).max(PLAYLIST_SWITCHER_MAX_CARDS - 1),
  cards: z.array(card).max(PLAYLIST_SWITCHER_MAX_CARDS),
}).refine(state => state.selected < state.cards.length, { message: 'selected out of range' });

/** Owns one native macOS playlist switcher while its session stays in React. */
export function registerPlaylistSwitcherHandlers(
  load = loadMacosPlaylistSwitcherBridge,
  platform = process.platform,
  resolveCover: (url: string) => Promise<Buffer | null> = url => loadArtwork(url, COVER_SIZE),
): void {
  let bridge: MacosPlaylistSwitcherBridge | null = null;
  let owner: WebContents | null = null;
  const covers = createCoverQueue(resolveCover, (url, data) => bridge?.setPlaylistSwitcherCover(url, data), 'PlaylistSwitcher');

  const stop = () => {
    covers.reset();
    owner?.removeListener('did-start-loading', stop);
    owner?.removeListener('destroyed', stop);
    owner = null;
    bridge?.stopPlaylistSwitcher();
  };

  ipcMain.handle('ipc:playlistSwitcher:start', event => {
    if (platform !== 'darwin' || process.env['LYRICS_ADAPTER_DISABLE_NATIVE_GLASS'] === '1') return ok(false);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || event.senderFrame !== event.sender.mainFrame) return fail('Invalid window');
    if (owner && owner !== event.sender) return fail('Surface already owned');
    try {
      bridge ??= load();
      if (!bridge) return ok(false);
      stop();
      const sender = event.sender;
      const started = bridge.startPlaylistSwitcher(win.getNativeWindowHandle(), action => {
        if (owner === sender && !sender.isDestroyed()) sender.send('playlist-switcher-action', action);
      });
      if (started) {
        owner = sender;
        sender.once('did-start-loading', stop);
        sender.once('destroyed', stop);
      }
      return ok(started);
    } catch (error) {
      stop();
      logger.warn('[PlaylistSwitcher] Native surface unavailable; using web switcher:', error);
      return ok(false);
    }
  });

  ipcMain.handle('ipc:playlistSwitcher:update', (event, payload: unknown) => {
    if (owner !== event.sender || event.senderFrame !== event.sender.mainFrame) return fail('Inactive surface');
    const state = parsePayload(playlistSwitcherStateSchema, payload);
    if (!state.ok) return state;
    try {
      bridge!.updatePlaylistSwitcher(state.data);
      if (state.data.open) covers.request(state.data.cards.flatMap(entry => (entry.cover ? [entry.cover] : [])));
      return ok(undefined);
    } catch (error) {
      stop();
      logger.warn('[PlaylistSwitcher] Update failed:', error);
      return fail('Native playlist switcher unavailable');
    }
  });

  ipcMain.handle('ipc:playlistSwitcher:stop', event => {
    if (owner === event.sender && event.senderFrame === event.sender.mainFrame) stop();
    return ok(undefined);
  });
}
