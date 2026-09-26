// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WallChromeAction, WallChromeState } from '../../../src/types/wallChrome';
import { registerWallChromeHandlers } from '../../../electron/ipc/wallChromeHandlers';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn(), netFetch: vi.fn(), createFromBuffer: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  net: { fetch: mocks.netFetch },
  nativeImage: { createFromBuffer: mocks.createFromBuffer },
}));

const state = (imageUrls: Array<string | null> = []): WallChromeState => ({
  presentation: { x: 0.01, y: 0.05, width: 0.03, height: 0.05, opacity: 1 },
  darkMode: true,
  title: 'Local',
  labels: { back: 'Back to library', source: 'Local, switch music source' },
  sections: [
    { title: 'Library', items: [
      { id: 'slot:local', title: 'Local', count: 118, icon: 'local', checked: true, imageUrl: null },
      { id: 'slot:online', title: 'Online History', count: 0, icon: 'history', checked: false, imageUrl: null },
    ] },
    { title: 'Playlists', items: imageUrls.map((imageUrl, index) => ({
      id: `playlist:qq:${index}`, title: `List ${index}`, count: 5, icon: 'playlist' as const, checked: false, imageUrl,
    })) },
  ],
});

function sender() { return Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }); }

function setup(platform: NodeJS.Platform = 'darwin') {
  let onAction: ((action: WallChromeAction) => void) | undefined;
  const bridge = {
    startWallChrome: vi.fn((_handle: Buffer, callback: (action: WallChromeAction) => void) => { onAction = callback; return true; }),
    updateWallChrome: vi.fn(),
    setWallChromeArtwork: vi.fn(),
    stopWallChrome: vi.fn(),
  };
  const load = vi.fn(() => bridge);
  registerWallChromeHandlers(load, platform);
  const owner = sender();
  const event = { sender: owner, senderFrame: owner.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) => {
    const handler = mocks.handle.mock.calls.find(call => call[0] === `ipc:wallChrome:${name}`)![1];
    return handler(source, value);
  };
  return { bridge, load, owner, event, invoke, emit: (action: WallChromeAction) => onAction?.(action) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fromWebContents.mockReturnValue({ getNativeWindowHandle: () => Buffer.alloc(8) });
  mocks.netFetch.mockResolvedValue({ ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(4) });
  mocks.createFromBuffer.mockReturnValue({ isEmpty: () => false, resize: () => ({ toPNG: () => Buffer.from('png') }) });
});

describe('native wall chrome lifecycle', () => {
  it('keeps other platforms on the web chrome without loading native code', () => {
    const { load, invoke } = setup('win32');
    expect(invoke('start')).toEqual({ ok: true, data: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('starts for the main frame only and forwards actions to its owner', () => {
    const { bridge, invoke, event, owner, emit } = setup();
    expect(invoke('start', undefined, { ...event, senderFrame: {} }).ok).toBe(false);
    expect(invoke('start')).toEqual({ ok: true, data: true });
    emit({ type: 'select', id: 'slot:online' });
    expect(owner.send).toHaveBeenCalledWith('wall-chrome-action', { type: 'select', id: 'slot:online' });
    expect(bridge.startWallChrome).toHaveBeenCalledOnce();
  });

  it('validates state and rejects updates from a page that does not own the surface', async () => {
    const { bridge, invoke } = setup();
    invoke('start');
    expect((await invoke('update', { ...state(), title: 42 })).ok).toBe(false);
    const stranger = sender();
    expect((await invoke('update', state(), { sender: stranger, senderFrame: stranger.mainFrame })).ok).toBe(false);
    expect(await invoke('update', state())).toEqual({ ok: true, data: undefined });
    expect(bridge.updateWallChrome).toHaveBeenCalledOnce();
  });

  it('fetches each playlist artwork once and only over allowed protocols', async () => {
    const { bridge, invoke } = setup();
    invoke('start');
    await invoke('update', state(['https://y.qq.com/a.jpg', 'file:///etc/passwd', null]));
    await invoke('update', state(['https://y.qq.com/a.jpg']));
    await vi.waitFor(() => expect(bridge.setWallChromeArtwork).toHaveBeenCalledOnce());
    expect(mocks.netFetch).toHaveBeenCalledOnce();
    expect(mocks.netFetch).toHaveBeenCalledWith('https://y.qq.com/a.jpg');
    expect(bridge.setWallChromeArtwork).toHaveBeenCalledWith('https://y.qq.com/a.jpg', Buffer.from('png'));
  });

  it('stops the surface when native code fails and on navigation', async () => {
    const { bridge, invoke, owner } = setup();
    invoke('start');
    bridge.updateWallChrome.mockImplementationOnce(() => { throw new Error('boom'); });
    expect((await invoke('update', state())).ok).toBe(false);
    expect(bridge.stopWallChrome).toHaveBeenCalled();

    bridge.stopWallChrome.mockClear();
    invoke('start');
    owner.emit('did-start-loading');
    expect(bridge.stopWallChrome).toHaveBeenCalled();
  });
});
