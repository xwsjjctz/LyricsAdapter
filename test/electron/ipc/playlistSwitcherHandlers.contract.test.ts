// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPlaylistSwitcherHandlers } from '../../../electron/ipc/playlistSwitcherHandlers';
import type { PlaylistSwitcherAction, PlaylistSwitcherState } from '../../../src/types/playlistSwitcher';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  net: { fetch: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
}));

const card = (cover: string | null) => ({ name: 'Road Trip', detail: '10 tracks', symbol: 'music.note.list', cover });
const state = (cards = [card('cover://a'), card('cover://b'), card(null)]): PlaylistSwitcherState => ({
  open: true, darkMode: true, label: 'Switch playlists', hint: 'Release Cmd to confirm', selected: 0, cards,
});
function sender() { return Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }); }
function setup(platform: NodeJS.Platform = 'darwin') {
  const bridge = {
    startPlaylistSwitcher: vi.fn().mockReturnValue(true), updatePlaylistSwitcher: vi.fn(),
    setPlaylistSwitcherCover: vi.fn(), stopPlaylistSwitcher: vi.fn(),
  };
  const resolveCover = vi.fn(async (url: string) => Buffer.from(url));
  const load = vi.fn(() => bridge);
  registerPlaylistSwitcherHandlers(load, platform, resolveCover);
  const owner = sender(), event = { sender: owner, senderFrame: owner.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) =>
    mocks.handle.mock.calls.find(call => call[0] === `ipc:playlistSwitcher:${name}`)![1](source, value);
  return { bridge, load, owner, event, invoke, resolveCover };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => { vi.clearAllMocks(); mocks.fromWebContents.mockReturnValue({ getNativeWindowHandle: () => Buffer.alloc(8) }); });

describe('native playlist switcher', () => {
  it('never loads AppKit outside macOS', () => {
    const { load, invoke } = setup('win32');
    expect(invoke('start')).toEqual({ ok: true, data: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('honours the native glass opt-out used by the web fallback tests', () => {
    vi.stubEnv('LYRICS_ADAPTER_DISABLE_NATIVE_GLASS', '1');
    try {
      const { load, invoke } = setup();
      expect(invoke('start')).toEqual({ ok: true, data: false });
      expect(load).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it('validates state and ownership, routes actions and releases on reload', () => {
    const { bridge, invoke, owner, event } = setup();
    expect(invoke('start', undefined, { ...event, senderFrame: {} }).ok).toBe(false);
    expect(invoke('start')).toEqual({ ok: true, data: true });
    const emit = bridge.startPlaylistSwitcher.mock.calls[0]![1] as (action: PlaylistSwitcherAction) => void;
    emit({ type: 'hover', value: 2 });
    expect(owner.send).toHaveBeenCalledWith('playlist-switcher-action', { type: 'hover', value: 2 });

    const other = sender();
    expect(invoke('update', state(), { sender: other, senderFrame: other.mainFrame }).ok).toBe(false);
    expect(invoke('start', undefined, { sender: other, senderFrame: other.mainFrame }).ok).toBe(false);
    expect(invoke('update', { ...state(), selected: 3 }).ok).toBe(false);
    expect(invoke('update', { ...state(), label: '' }).ok).toBe(false);
    expect(invoke('update', { ...state(), cards: Array.from({ length: 201 }, () => card(null)) }).ok).toBe(false);
    expect(bridge.updatePlaylistSwitcher).not.toHaveBeenCalled();
    expect(invoke('update', state()).ok).toBe(true);
    expect(bridge.updatePlaylistSwitcher).toHaveBeenCalledWith(state());

    owner.emit('did-start-loading');
    expect(bridge.stopPlaylistSwitcher).toHaveBeenCalled();
    owner.send.mockClear();
    emit({ type: 'activate', value: 0 });
    expect(owner.send).not.toHaveBeenCalled();
    expect(invoke('update', state()).ok).toBe(false);
  });

  it('resolves each cover once and pushes it by URL', async () => {
    const { bridge, invoke, resolveCover } = setup();
    invoke('start');
    invoke('update', state());
    invoke('update', { ...state(), selected: 1 });
    await flush();
    expect(resolveCover.mock.calls.map(call => call[0])).toEqual(['cover://a', 'cover://b']);
    expect(bridge.setPlaylistSwitcherCover).toHaveBeenCalledWith('cover://a', Buffer.from('cover://a'));
    expect(bridge.setPlaylistSwitcherCover).toHaveBeenCalledWith('cover://b', Buffer.from('cover://b'));
  });

  it('does not fetch covers for a closed panel and drops ones that finish after release', async () => {
    const { bridge, invoke, owner, resolveCover } = setup();
    invoke('start');
    invoke('update', { ...state([]), open: false, selected: -1 });
    expect(resolveCover).not.toHaveBeenCalled();
    invoke('update', state([card('cover://late')]));
    owner.emit('destroyed');
    await flush();
    expect(bridge.setPlaylistSwitcherCover).not.toHaveBeenCalled();
  });

  it('releases the surface on native failure so the web switcher can return', () => {
    const { bridge, invoke } = setup();
    invoke('start');
    bridge.updatePlaylistSwitcher.mockImplementation(() => { throw new Error('surface unavailable'); });
    expect(invoke('update', state()).ok).toBe(false);
    expect(bridge.stopPlaylistSwitcher).toHaveBeenCalled();
    expect(invoke('update', state()).ok).toBe(false);
  });
});
