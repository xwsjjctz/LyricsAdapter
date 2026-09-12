// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPlayerSlidersHandlers } from '../../../electron/ipc/playerSlidersHandlers';
import type { PlayerSliderAction } from '../../../src/types/playerSliders';
const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle }, BrowserWindow: { fromWebContents: mocks.fromWebContents } }));
const rect = { x: 0.3, y: 0.9, width: 0.2, height: 0.03, opacity: 1 };
const state = { seek: rect, volume: rect, currentTime: 10, duration: 60, level: 0.4, enabled: true, labels: { seek: 'Seek', volume: 'Volume' } };
function sender() { return Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }); }
function setup(platform: NodeJS.Platform = 'darwin') {
  const bridge = { startPlayerSliders: vi.fn().mockReturnValue(true), updatePlayerSliders: vi.fn(), stopPlayerSliders: vi.fn() };
  const load = vi.fn(() => bridge); registerPlayerSlidersHandlers(load, platform);
  const owner = sender(), event = { sender: owner, senderFrame: owner.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) => mocks.handle.mock.calls.find(call => call[0] === `ipc:playerSliders:${name}`)![1](source, value);
  return { bridge, load, owner, event, invoke };
}
beforeEach(() => { vi.clearAllMocks(); mocks.fromWebContents.mockReturnValue({ getNativeWindowHandle: () => Buffer.alloc(8) }); });
describe('native player sliders', () => {
  it('never loads AppKit on Windows', () => {
    const { load, invoke } = setup('win32'); expect(invoke('start')).toEqual({ ok: true, data: false }); expect(load).not.toHaveBeenCalled();
  });
  it('validates geometry and ownership, routes actions and releases on reload', () => {
    const { bridge, invoke, owner, event } = setup();
    expect(invoke('start', undefined, { ...event, senderFrame: {} }).ok).toBe(false);
    expect(invoke('start')).toEqual({ ok: true, data: true });
    const emit = bridge.startPlayerSliders.mock.calls[0]![1] as (action: PlayerSliderAction) => void;
    emit({ type: 'volume', value: 0.3 }); expect(owner.send).toHaveBeenCalledWith('player-slider-action', { type: 'volume', value: 0.3 });
    const other = sender();
    expect(invoke('update', state, { sender: other, senderFrame: other.mainFrame }).ok).toBe(false);
    expect(invoke('update', { ...state, seek: { ...rect, opacity: NaN } }).ok).toBe(false);
    expect(invoke('update', { ...state, level: 2 }).ok).toBe(false);
    expect(bridge.updatePlayerSliders).not.toHaveBeenCalled();
    expect(invoke('update', state).ok).toBe(true); expect(bridge.updatePlayerSliders).toHaveBeenCalledWith(state);
    owner.emit('did-start-loading'); expect(bridge.stopPlayerSliders).toHaveBeenCalled();
    owner.send.mockClear(); emit({ type: 'seek', value: 12 }); expect(owner.send).not.toHaveBeenCalled();
    expect(invoke('update', state).ok).toBe(false);
  });
  it('releases the surface on native failure so web controls can return', () => {
    const { bridge, invoke } = setup(); invoke('start');
    bridge.updatePlayerSliders.mockImplementation(() => { throw new Error('surface unavailable'); });
    expect(invoke('update', state).ok).toBe(false); expect(bridge.stopPlayerSliders).toHaveBeenCalledTimes(2);
    expect(invoke('update', state).ok).toBe(false);
  });
});
