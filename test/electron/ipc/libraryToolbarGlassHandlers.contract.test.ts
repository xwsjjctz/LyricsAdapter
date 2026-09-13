// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerLibraryToolbarGlassHandlers } from '../../../electron/ipc/libraryToolbarGlassHandlers';
import type { LibraryToolbarGlassAction } from '../../../src/types/libraryToolbarGlass';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));

const hidden = { x: 0, y: 1, width: 0, height: 0, opacity: 0 };
const state = {
  darkMode: true,
  primary: { presentation: { x: 0.7, y: 0.1, width: 0.04, height: 0.05, opacity: 1 }, symbol: 'edit' as const, enabled: true, emphasized: false, tintColor: '', label: 'Edit' },
  secondary: { presentation: hidden, symbol: 'upload-file' as const, enabled: true, emphasized: true, tintColor: '#ff66aa', label: 'Import' },
};
function sender() { return Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }); }
function setup(platform: NodeJS.Platform = 'darwin') {
  const bridge = {
    startLibraryToolbarGlass: vi.fn().mockReturnValue(true),
    updateLibraryToolbarGlass: vi.fn(),
    stopLibraryToolbarGlass: vi.fn(),
  };
  const load = vi.fn(() => bridge);
  registerLibraryToolbarGlassHandlers(load, platform);
  const owner = sender();
  const event = { sender: owner, senderFrame: owner.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) => (
    mocks.handle.mock.calls.find(call => call[0] === `ipc:libraryToolbarGlass:${name}`)![1](source, value)
  );
  return { bridge, load, owner, event, invoke };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fromWebContents.mockReturnValue({ getNativeWindowHandle: () => Buffer.alloc(8) });
});

describe('native library toolbar glass buttons', () => {
  it('never loads AppKit outside macOS', () => {
    const { load, invoke } = setup('win32');
    expect(invoke('start')).toEqual({ ok: true, data: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('validates updates, forwards actions, and releases on reload', () => {
    const { bridge, invoke, owner } = setup();
    expect(invoke('start')).toEqual({ ok: true, data: true });
    const emit = bridge.startLibraryToolbarGlass.mock.calls[0]![1] as (action: LibraryToolbarGlassAction) => void;
    emit({ type: 'primary', value: 0 });
    expect(owner.send).toHaveBeenCalledWith('library-toolbar-glass-action', { type: 'primary', value: 0 });
    expect(invoke('update', { ...state, primary: { ...state.primary, tintColor: 'pink' } }).ok).toBe(false);
    expect(invoke('update', state).ok).toBe(true);
    expect(bridge.updateLibraryToolbarGlass).toHaveBeenCalledWith(state);
    owner.emit('did-start-loading');
    expect(bridge.stopLibraryToolbarGlass).toHaveBeenCalled();
  });
});
