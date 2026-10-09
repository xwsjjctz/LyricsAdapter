// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSettingsPanelHandlers } from '../../../electron/ipc/settingsPanelHandlers';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), create: vi.fn(), fromWebContents: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: Object.assign(mocks.create, { fromWebContents: mocks.fromWebContents }),
  shell: { openExternal: vi.fn() },
}));
vi.mock('../../../electron/logger', () => ({ logger: { warn: vi.fn() } }));

const sender = () => Object.assign(new EventEmitter(), {
  mainFrame: {}, send: vi.fn(), isDestroyed: () => false, focus: vi.fn(), setWindowOpenHandler: vi.fn(),
});
function setup(platform: NodeJS.Platform = 'darwin') {
  const owner = sender(), contents = sender();
  const parent = Object.assign(new EventEmitter(), {
    webContents: owner, getParentWindow: () => null, isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 100, width: 900, height: 650 }),
  });
  let destroyed = false; let visible = false;
  const panel = Object.assign(new EventEmitter(), {
    webContents: contents, isDestroyed: () => destroyed, isVisible: () => visible,
    setBounds: vi.fn(), getNativeWindowHandle: () => Buffer.alloc(8),
    loadURL: vi.fn().mockResolvedValue(undefined), show: vi.fn(() => { visible = true; }),
    hide: vi.fn(() => { visible = false; }),
    destroy: vi.fn(() => { destroyed = true; panel.emit('closed'); }),
  });
  mocks.create.mockImplementation(function () { return panel; });
  mocks.fromWebContents.mockReturnValue(parent);
  const bridge = { attachSettingsGlass: vi.fn().mockReturnValue(true) };
  const load = vi.fn(() => bridge);
  registerSettingsPanelHandlers(load, platform);
  const event = { sender: owner, senderFrame: owner.mainFrame };
  const childEvent = { sender: contents, senderFrame: contents.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) =>
    mocks.handle.mock.calls.find(call => call[0] === `ipc:settingsPanel:${name}`)![1](source, value);
  return { owner, contents, parent, panel, bridge, load, event, childEvent, invoke };
}
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('native settings panel', () => {
  it('keeps other platforms and disabled native glass on the web surface', async () => {
    const other = setup('win32');
    expect(await other.invoke('open', 'general')).toEqual({ ok: true, data: false });
    expect(other.load).not.toHaveBeenCalled();
    vi.stubEnv('LYRICS_ADAPTER_DISABLE_NATIVE_GLASS', '1');
    const disabled = setup();
    expect(await disabled.invoke('open', 'general')).toEqual({ ok: true, data: false });
    expect(disabled.load).not.toHaveBeenCalled();
  });
  it('rejects invalid sections, nested frames and unauthorized size or close requests', async () => {
    const f = setup();
    expect((await f.invoke('open', 'unknown')).ok).toBe(false);
    expect((await f.invoke('open', 'general', { ...f.event, senderFrame: {} })).ok).toBe(false);
    expect(f.load).not.toHaveBeenCalled();
    const opening = f.invoke('open', 'focus');
    expect(f.invoke('ready', 300).ok).toBe(false);
    expect(f.invoke('ready', NaN, f.childEvent).ok).toBe(false);
    f.invoke('close', undefined, { sender: sender(), senderFrame: {} });
    expect(f.panel.destroy).not.toHaveBeenCalled();
    f.invoke('ready', 300, f.childEvent);
    expect(await opening).toEqual({ ok: true, data: true });
    f.invoke('close');
  });
  it('waits for controls to mount, clamps placement, and hides rather than destroys on close', async () => {
    const f = setup(); const opening = f.invoke('open', 'shortcuts');
    expect(f.panel.show).not.toHaveBeenCalled();
    expect(f.panel.loadURL).toHaveBeenCalledWith('app://localhost/index.html?settings-panel=shortcuts');
    // The handler is still awaiting loadURL; let it start waiting for the controls.
    await Promise.resolve(); await Promise.resolve();
    f.invoke('ready', 800, f.childEvent);
    expect(await opening).toEqual({ ok: true, data: true });
    expect(f.panel.show).toHaveBeenCalledOnce();
    expect(f.panel.setBounds).toHaveBeenLastCalledWith({ x: 230, y: 191, width: 640, height: 468 });
    expect(await f.invoke('open', 'general')).toEqual({ ok: true, data: true });
    expect(f.contents.send).toHaveBeenCalledWith('settings-panel-section', 'general');
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(f.invoke('previewOpacity', 0.6, f.childEvent).ok).toBe(true);
    expect(f.owner.send).toHaveBeenCalledWith('settings-panel-preview-opacity', 0.6);
    expect(f.invoke('previewOpacity', 2, f.childEvent).ok).toBe(false);
    expect(f.invoke('previewOpacity', 0.5).ok).toBe(false);
    expect(f.invoke('shortcut', { key: 'k', modifiers: 1 }, f.childEvent).ok).toBe(true);
    expect(f.owner.send).toHaveBeenCalledWith('settings-panel-shortcut', 'k', 1);
    expect(f.invoke('shortcut', { key: 'k', modifiers: 16 }, f.childEvent).ok).toBe(false);
    expect(f.invoke('shortcut', { key: 'k', modifiers: 1 }).ok).toBe(false);
    f.invoke('close', undefined, f.childEvent);
    expect(f.owner.send).toHaveBeenCalledWith('settings-panel-closed');
    // The renderer is kept for the next open, which only shows it again.
    expect(f.panel.hide).toHaveBeenCalledOnce();
    expect(f.panel.destroy).not.toHaveBeenCalled();
    expect(await f.invoke('open', 'focus')).toEqual({ ok: true, data: true });
    expect(f.contents.send).toHaveBeenLastCalledWith('settings-panel-section', 'focus');
    expect(f.panel.show).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledOnce();
    // A reload of the player releases the window and every listener.
    f.owner.emit('did-start-loading');
    expect(f.panel.destroy).toHaveBeenCalledOnce();
    expect(f.parent.listenerCount('move')).toBe(0); expect(f.parent.listenerCount('resize')).toBe(0);
    expect(f.owner.listenerCount('did-start-loading')).toBe(0);
  });
  it('prewarms a hidden panel that the first open only has to show', async () => {
    const f = setup();
    expect(f.invoke('prewarm')).toEqual({ ok: true, data: true });
    expect(f.panel.loadURL).toHaveBeenCalledWith('app://localhost/index.html?settings-panel=general');
    await Promise.resolve(); await Promise.resolve();
    f.invoke('ready', 500, f.childEvent);
    expect(f.panel.show).not.toHaveBeenCalled();
    expect(f.invoke('prewarm')).toEqual({ ok: true, data: true });
    expect(await f.invoke('open', 'cloud')).toEqual({ ok: true, data: true });
    expect(f.contents.send).toHaveBeenCalledWith('settings-panel-section', 'cloud');
    expect(f.panel.show).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it('returns to web settings when AppKit is unavailable without leaking a child window', async () => {
    const f = setup(); f.bridge.attachSettingsGlass.mockReturnValue(false);
    expect(await f.invoke('open', 'general')).toEqual({ ok: true, data: false });
    expect(f.panel.destroy).toHaveBeenCalledOnce();
    expect(f.panel.loadURL).not.toHaveBeenCalled();
  });
  it('cleans up an in-progress open when the player reloads', async () => {
    const f = setup(); const opening = f.invoke('open', 'general');
    f.owner.emit('did-start-loading');
    expect(await opening).toEqual({ ok: true, data: false });
    expect(f.panel.destroy).toHaveBeenCalledOnce();
  });
});
