// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerNativePaletteHandlers } from '../../../electron/ipc/nativePaletteHandlers';
import type { NativePaletteAction, NativePaletteState } from '../../../src/types/nativePalette';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  net: { fetch: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
}));

const row = (cover: string | null) => ({
  section: '', title: 'Track', subtitle: 'Artist', detail: '', shortcut: '', symbol: 'music.note', cover, nested: false, accessory: '', accessoryLabel: '', menu: false,
});
const state = (rows = [row('cover://a'), row('cover://b'), row(null)]): NativePaletteState => ({
  open: true, darkMode: true, label: 'Palette', modes: ['Library', 'Features'], modeIndex: 0, hint: 'Shift+Tab',
  placeholder: 'Search', searchSymbol: 'magnifyingglass', query: 'x', trail: '', loading: false, empty: 'None',
  selected: 0, rows,
});
function sender() { return Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }); }
function setup(platform: NodeJS.Platform = 'darwin') {
  const bridge = {
    startNativePalette: vi.fn().mockReturnValue(true), updateNativePalette: vi.fn(),
    setNativePaletteCover: vi.fn(), stopNativePalette: vi.fn(),
  };
  const resolveCover = vi.fn(async (url: string) => Buffer.from(url));
  const load = vi.fn(() => bridge);
  registerNativePaletteHandlers(load, platform, resolveCover);
  const owner = sender(), event = { sender: owner, senderFrame: owner.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) =>
    mocks.handle.mock.calls.find(call => call[0] === `ipc:nativePalette:${name}`)![1](source, value);
  return { bridge, load, owner, event, invoke, resolveCover };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => { vi.clearAllMocks(); mocks.fromWebContents.mockReturnValue({ getNativeWindowHandle: () => Buffer.alloc(8) }); });

describe('native command palette', () => {
  it('never loads AppKit outside macOS', () => {
    const { load, invoke } = setup('win32');
    expect(invoke('start')).toEqual({ ok: true, data: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('validates state and ownership, routes actions and releases on reload', () => {
    const { bridge, invoke, owner, event } = setup();
    expect(invoke('start', undefined, { ...event, senderFrame: {} }).ok).toBe(false);
    expect(invoke('start')).toEqual({ ok: true, data: true });
    const emit = bridge.startNativePalette.mock.calls[0]![1] as (action: NativePaletteAction) => void;
    emit({ type: 'query', value: 0, text: 'moon' });
    expect(owner.send).toHaveBeenCalledWith('native-palette-action', { type: 'query', value: 0, text: 'moon' });

    const other = sender();
    expect(invoke('update', state(), { sender: other, senderFrame: other.mainFrame }).ok).toBe(false);
    expect(invoke('update', { ...state(), modeIndex: 2 }).ok).toBe(false);
    expect(invoke('update', { ...state(), rows: Array.from({ length: 201 }, () => row(null)) }).ok).toBe(false);
    expect(bridge.updateNativePalette).not.toHaveBeenCalled();
    expect(invoke('update', state()).ok).toBe(true);
    expect(bridge.updateNativePalette).toHaveBeenCalledWith(state());

    owner.emit('did-start-loading');
    expect(bridge.stopNativePalette).toHaveBeenCalled();
    owner.send.mockClear();
    emit({ type: 'escape', value: 0, text: '' });
    expect(owner.send).not.toHaveBeenCalled();
    expect(invoke('update', state()).ok).toBe(false);
  });

  it('resolves each cover once and pushes it by URL', async () => {
    const { bridge, invoke, resolveCover } = setup();
    invoke('start');
    invoke('update', state());
    invoke('update', state());
    await flush();
    expect(resolveCover.mock.calls.map(call => call[0])).toEqual(['cover://a', 'cover://b']);
    expect(bridge.setNativePaletteCover).toHaveBeenCalledWith('cover://a', Buffer.from('cover://a'));
    expect(bridge.setNativePaletteCover).toHaveBeenCalledWith('cover://b', Buffer.from('cover://b'));
  });

  it('drops covers that finish after the surface was released', async () => {
    const { bridge, invoke, owner } = setup();
    invoke('start');
    invoke('update', state([row('cover://late')]));
    owner.emit('destroyed');
    await flush();
    expect(bridge.setNativePaletteCover).not.toHaveBeenCalled();
  });

  it('releases the surface on native failure so the web palette can return', () => {
    const { bridge, invoke } = setup();
    invoke('start');
    bridge.updateNativePalette.mockImplementation(() => { throw new Error('surface unavailable'); });
    expect(invoke('update', state()).ok).toBe(false);
    expect(invoke('update', state()).ok).toBe(false);
  });
});
