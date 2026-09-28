// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPlayerControlbarHandlers } from '../../../electron/ipc/playerControlbarHandlers';
import type { PlayerControlbarAction } from '../../../src/types/playerControlbar';
const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn(), netFetch: vi.fn(), createFromBuffer: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  net: { fetch: mocks.netFetch },
  nativeImage: { createFromBuffer: mocks.createFromBuffer },
}));
const rect = { x: 0.3, y: 0.9, width: 0.2, height: 0.03, opacity: 1 };
const state = {
  presentation: rect, darkMode: true, currentTime: 10, duration: 60, volume: 0.4, enabled: true,
  isPlaying: false, playbackMode: 'order', title: 'Track', artist: 'Artist',
  labels: { focus: 'Focus', playPause: 'Play', previous: 'Previous', next: 'Next', seek: 'Seek', volume: 'Volume', mute: 'Mute', mode: 'Mode' },
};
function sender() { return Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }); }
function setup(platform: NodeJS.Platform = 'darwin') {
  const bridge = {
    startPlayerControlbar: vi.fn().mockReturnValue(true), updatePlayerControlbar: vi.fn(),
    updatePlayerControlbarArtwork: vi.fn(), stopPlayerControlbar: vi.fn(),
  };
  const load = vi.fn(() => bridge); registerPlayerControlbarHandlers(load, platform);
  const owner = sender(), event = { sender: owner, senderFrame: owner.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) => mocks.handle.mock.calls.find(call => call[0] === `ipc:playerControlbar:${name}`)![1](source, value);
  return { bridge, load, owner, event, invoke };
}
beforeEach(() => { vi.clearAllMocks(); mocks.fromWebContents.mockReturnValue({ getNativeWindowHandle: () => Buffer.alloc(8) }); });
describe('native player control bar', () => {
  it('never loads AppKit on Windows', () => {
    const { load, invoke } = setup('win32'); expect(invoke('start')).toEqual({ ok: true, data: false }); expect(load).not.toHaveBeenCalled();
  });
  it('validates geometry and ownership, routes actions and releases on reload', () => {
    const { bridge, invoke, owner, event } = setup();
    expect(invoke('start', undefined, { ...event, senderFrame: {} }).ok).toBe(false);
    expect(invoke('start')).toEqual({ ok: true, data: true });
    const emit = bridge.startPlayerControlbar.mock.calls[0]![1] as (action: PlayerControlbarAction) => void;
    emit({ type: 'volume', value: 0.3 }); expect(owner.send).toHaveBeenCalledWith('player-controlbar-action', { type: 'volume', value: 0.3 });
    const other = sender();
    expect(invoke('update', state, { sender: other, senderFrame: other.mainFrame }).ok).toBe(false);
    expect(invoke('update', { ...state, presentation: { ...rect, opacity: NaN } }).ok).toBe(false);
    expect(invoke('update', { ...state, volume: 2 }).ok).toBe(false);
    expect(bridge.updatePlayerControlbar).not.toHaveBeenCalled();
    expect(invoke('update', state).ok).toBe(true); expect(bridge.updatePlayerControlbar).toHaveBeenCalledWith(state);
    owner.emit('did-start-loading'); expect(bridge.stopPlayerControlbar).toHaveBeenCalled();
    owner.send.mockClear(); emit({ type: 'seek', value: 12 }); expect(owner.send).not.toHaveBeenCalled();
    expect(invoke('update', state).ok).toBe(false);
  });
  it('releases the surface on native failure so web controls can return', () => {
    const { bridge, invoke } = setup(); invoke('start');
    bridge.updatePlayerControlbar.mockImplementation(() => { throw new Error('surface unavailable'); });
    expect(invoke('update', state).ok).toBe(false); expect(bridge.stopPlayerControlbar).toHaveBeenCalledTimes(2);
    expect(invoke('update', state).ok).toBe(false);
  });
  it('updates artwork independently from playback state', async () => {
    const { bridge, invoke } = setup(); invoke('start');
    const png = Buffer.from([1, 2, 3]);
    mocks.netFetch.mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => png });
    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => false, resize: () => ({ toPNG: () => png }) });
    await expect(invoke('artwork', 'cover://track.png?size=128')).resolves.toEqual({ ok: true, data: undefined });
    expect(bridge.updatePlayerControlbarArtwork).toHaveBeenCalledWith(png);
    await expect(invoke('artwork', null)).resolves.toEqual({ ok: true, data: undefined });
    expect(bridge.updatePlayerControlbarArtwork).toHaveBeenLastCalledWith(null);
  });
  it('bypasses the shared HTTP cache so a renderer-negotiated WebP variant is never reused', async () => {
    const { invoke } = setup(); invoke('start');
    const png = Buffer.from([1, 2, 3]);
    mocks.netFetch.mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => png });
    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => false, resize: () => ({ toPNG: () => png }) });
    const url = 'https://y.gtimg.cn/music/photo_new/T002R150x150M000000Cywix0MAwfk.jpg';
    await invoke('artwork', url);
    const init = mocks.netFetch.mock.calls[0]![1] as RequestInit;
    expect(mocks.netFetch.mock.calls[0]![0]).toBe(url);
    expect(init.cache).toBe('no-store');
    expect(new Headers(init.headers).get('accept')).not.toMatch(/webp|avif/);
  });
});
