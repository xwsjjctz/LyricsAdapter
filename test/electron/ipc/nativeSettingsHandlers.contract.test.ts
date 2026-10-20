// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerNativeSettingsHandlers } from '../../../electron/ipc/nativeSettingsHandlers';
import type { NativeSettingsAction, NativeSettingsControl, NativeSettingsRow, NativeSettingsState } from '../../../src/types/nativeSettings';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
}));
vi.mock('../../../electron/logger', () => ({ logger: { warn: vi.fn() } }));

const popup: NativeSettingsControl = {
  type: 'popup', id: 'general:language', value: 'en', options: [{ value: 'en', title: 'English' }], enabled: true, label: 'Language',
};
const row = (controls: NativeSettingsControl[] = [popup]): NativeSettingsRow => ({
  id: 'general:language', layout: 'inline', title: 'Language', detail: '', footnote: '', tone: 'default', detailTone: 'secondary', controls,
});
const state = (rows: NativeSettingsRow[] = [row()]): NativeSettingsState => ({
  open: true, darkMode: true, title: 'Settings', closeLabel: 'Close', unsavedLabel: 'Unsaved',
  reveal: { section: 'general', token: 0 },
  sections: [{
    id: 'general', title: 'General', navTitle: 'General', symbol: 'slider.horizontal.3', unsaved: false,
    blocks: [{ id: 'general', kind: 'card', heading: '', headingControls: [], rows }],
  }],
  dialog: null,
});
function sender() { return Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }); }
function setup(platform: NodeJS.Platform = 'darwin') {
  const bridge = {
    startNativeSettings: vi.fn().mockReturnValue(true), updateNativeSettings: vi.fn(),
    stopNativeSettings: vi.fn(), destroyNativeSettings: vi.fn(),
  };
  const load = vi.fn(() => bridge);
  registerNativeSettingsHandlers(load, platform);
  const owner = sender(), event = { sender: owner, senderFrame: owner.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) =>
    mocks.handle.mock.calls.find(call => call[0] === `ipc:nativeSettings:${name}`)![1](source, value);
  return { bridge, load, owner, event, invoke };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  // Independent of the shell running the tests.
  vi.stubEnv('LYRICS_ADAPTER_DISABLE_NATIVE_GLASS', '0');
  mocks.fromWebContents.mockReturnValue({ getNativeWindowHandle: () => Buffer.alloc(8) });
});

describe('native settings sheet', () => {
  it('keeps other platforms on the web sheet', () => {
    const { invoke, load } = setup('win32');
    expect(invoke('start')).toEqual({ ok: true, data: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the web sheet while native glass is disabled', () => {
    vi.stubEnv('LYRICS_ADAPTER_DISABLE_NATIVE_GLASS', '1');
    const { invoke, load } = setup();
    expect(invoke('start')).toEqual({ ok: true, data: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('validates ownership and snapshots, and routes input to the owner', () => {
    const { bridge, invoke, owner, event } = setup();
    expect(invoke('start', undefined, { ...event, senderFrame: {} }).ok).toBe(false);
    expect(invoke('start')).toEqual({ ok: true, data: true });
    const other = sender();
    expect(invoke('start', undefined, { sender: other, senderFrame: other.mainFrame }).ok).toBe(false);

    const emit = bridge.startNativeSettings.mock.calls[0]![1] as (action: NativeSettingsAction) => void;
    emit({ type: 'popup', id: 'general:language', value: 0, text: 'zh', code: '' });
    expect(owner.send).toHaveBeenCalledWith('native-settings-action', { type: 'popup', id: 'general:language', value: 0, text: 'zh', code: '' });

    expect(invoke('update', state(), { sender: other, senderFrame: other.mainFrame }).ok).toBe(false);
    expect(invoke('update', { ...state(), reveal: { section: 'nowhere', token: 0 } }).ok).toBe(false);
    expect(invoke('update', state(Array.from({ length: 161 }, () => row()))).ok).toBe(false);
    expect(invoke('update', state([row(Array.from({ length: 7 }, () => popup))])).ok).toBe(false);
    expect(bridge.updateNativeSettings).not.toHaveBeenCalled();
    expect(invoke('update', state()).ok).toBe(true);
    expect(bridge.updateNativeSettings).toHaveBeenCalledWith(state());
  });

  it('accepts only https links and PNG data images', () => {
    const { bridge, invoke } = setup();
    invoke('start');
    const link = (url: string): NativeSettingsControl => ({ type: 'link', id: 'plugins:repository', title: 'Repository', url });
    const image = (source: string): NativeSettingsControl => ({ type: 'image', id: 'qr', source, size: 128, label: 'QR' });
    expect(invoke('update', state([row([link('javascript:alert(1)')])])).ok).toBe(false);
    expect(invoke('update', state([row([link('http://example.com')])])).ok).toBe(false);
    expect(invoke('update', state([row([image('https://example.com/qr.png')])])).ok).toBe(false);
    expect(invoke('update', state([row([image('data:image/svg+xml;base64,PHN2Zz4=')])])).ok).toBe(false);
    expect(bridge.updateNativeSettings).not.toHaveBeenCalled();
    expect(invoke('update', state([row([link('https://example.com/plugins'), image('data:image/png;base64,iVBORw0KGgo=')])])).ok).toBe(true);
  });

  it('hides the sheet when settings close and removes it when the page reloads', () => {
    const { bridge, invoke, owner, event } = setup();
    invoke('start');
    expect(invoke('stop').ok).toBe(true);
    expect(bridge.stopNativeSettings).toHaveBeenCalledTimes(1);
    expect(bridge.destroyNativeSettings).not.toHaveBeenCalled();
    // A closed sheet no longer belongs to anyone, and its input goes nowhere.
    expect(invoke('update', state()).ok).toBe(false);

    // Reopening reuses the hidden sheet; a reload of its page removes it.
    expect(invoke('start')).toEqual({ ok: true, data: true });
    owner.emit('did-start-loading');
    expect(bridge.destroyNativeSettings).toHaveBeenCalledTimes(1);
    const emit = bridge.startNativeSettings.mock.calls[1]![1] as (action: NativeSettingsAction) => void;
    owner.send.mockClear();
    emit({ type: 'close', id: '', value: 0, text: '', code: '' });
    expect(owner.send).not.toHaveBeenCalled();
    expect(invoke('update', state(), event).ok).toBe(false);
  });

  it('falls back to the web sheet when AppKit refuses or fails', () => {
    const { bridge, invoke } = setup();
    bridge.startNativeSettings.mockImplementationOnce(() => { throw new Error('No window'); });
    expect(invoke('start')).toEqual({ ok: true, data: false });
    expect(bridge.destroyNativeSettings).toHaveBeenCalled();
    expect(invoke('start')).toEqual({ ok: true, data: true });
    bridge.updateNativeSettings.mockImplementationOnce(() => { throw new Error('AppKit rejected the settings sheet'); });
    expect(invoke('update', state())).toEqual({ ok: false, error: 'Native settings unavailable' });
  });
});
