// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusGlassAction, FocusGlassState } from '../../../src/types/focusGlass';
import { registerFocusGlassHandlers, focusGlassStateSchema } from '../../../electron/ipc/focusGlassHandlers';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), fromWebContents: vi.fn(), netFetch: vi.fn(), createFromBuffer: vi.fn() }));
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  net: { fetch: mocks.netFetch },
  nativeImage: { createFromBuffer: mocks.createFromBuffer },
}));
const state: FocusGlassState = {
  visible: true, darkMode: true, enabled: true, isPlaying: false, currentTime: 0, duration: 60, volume: 0.5, playbackMode: 'order', scale: 1,
  backdropLuminance: -1,
  presentation: { x: 0.25, y: 0.8, width: 0.5, height: 0.15, opacity: 1 },
  labels: { playPause: 'Play', previous: 'Previous', next: 'Next', seek: 'Seek', volume: 'Volume', mute: 'Mute', mode: 'Repeat' },
};
function sender() { return Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }); }
function whiteCoverImage() {
  const pixels = Buffer.alloc(8 * 8 * 4, 255);
  return {
    isEmpty: () => false,
    resize: () => ({ toBitmap: () => pixels, toPNG: () => pixels }),
  };
}
function setup(platform: NodeJS.Platform = 'darwin') {
  const bridge = { startFocusGlass: vi.fn().mockReturnValue(true), updateFocusGlass: vi.fn(), stopFocusGlass: vi.fn(), getPlaybackSymbols: vi.fn(() => ({ play_arrow: 'data:image/png;base64,fixture' })) };
  const load = vi.fn(() => bridge);
  registerFocusGlassHandlers(load, platform);
  const owner = sender();
  const event = { sender: owner, senderFrame: owner.mainFrame };
  const invoke = (name: string, value?: unknown, source = event) => {
    const handler = mocks.handle.mock.calls.find(call => call[0] === `ipc:focusGlass:${name}`)![1];
    return handler(source, value);
  };
  return { bridge, load, owner, event, invoke };
}
beforeEach(() => { vi.clearAllMocks(); mocks.fromWebContents.mockReturnValue({ getNativeWindowHandle: () => Buffer.alloc(8) }); });
describe('native focus glass lifecycle', () => {
  it('keeps non-macOS on the web controls without loading a native module', () => {
    const { load, invoke } = setup('win32');
    expect(invoke('start')).toEqual({ ok: true, data: false });
    expect(invoke('playbackSymbols')).toEqual({ ok: true, data: {} });
    expect(load).not.toHaveBeenCalled();
  });
  it('caches the system palette without starting a surface and rejects subframes', () => {
    const { bridge, invoke, event } = setup();
    expect(invoke('playbackSymbols', undefined, { ...event, senderFrame: {} }).ok).toBe(false);
    expect(bridge.getPlaybackSymbols).not.toHaveBeenCalled();
    expect(invoke('playbackSymbols')).toEqual({ ok: true, data: { play_arrow: 'data:image/png;base64,fixture' } });
    invoke('playbackSymbols');
    expect(bridge.getPlaybackSymbols).toHaveBeenCalledOnce();
    expect(bridge.startFocusGlass).not.toHaveBeenCalled();
  });
  it('returns existing icons when native symbol rendering fails', () => {
    const { bridge, invoke } = setup();
    bridge.getPlaybackSymbols.mockImplementation(() => { throw new Error('unavailable'); });
    expect(invoke('playbackSymbols')).toEqual({ ok: true, data: {} });
    invoke('playbackSymbols');
    expect(bridge.getPlaybackSymbols).toHaveBeenCalledOnce();
  });
  it('routes native intents only to the owner and disposes on navigation', () => {
    const { bridge, invoke, owner } = setup();
    expect(invoke('start')).toEqual({ ok: true, data: true });
    const emit = bridge.startFocusGlass.mock.calls[0]![1] as (action: FocusGlassAction) => void;
    emit({ type: 'seek', value: 12 });
    expect(owner.send).toHaveBeenCalledWith('focus-glass-action', { type: 'seek', value: 12 });
    expect(invoke('update', state).ok).toBe(true);
    expect(bridge.updateFocusGlass).toHaveBeenCalledWith(state);
    owner.emit('did-start-loading');
    expect(bridge.stopFocusGlass).toHaveBeenCalled();
    expect(owner.listenerCount('destroyed')).toBe(0);
    owner.send.mockClear();
    emit({ type: 'next', value: 0 });
    expect(owner.send).not.toHaveBeenCalled();
    expect(invoke('update', state).ok).toBe(false);
  });
  it('rejects subframes, other windows and invalid native geometry', () => {
    const { invoke, bridge, event } = setup();
    expect(invoke('start', undefined, { ...event, senderFrame: {} }).ok).toBe(false);
    invoke('start');
    const other = sender();
    expect(invoke('update', state, { sender: other, senderFrame: other.mainFrame }).ok).toBe(false);
    expect(invoke('update', { ...state, scale: Infinity }).ok).toBe(false);
    expect(invoke('update', { ...state, volume: 2 }).ok).toBe(false);
    expect(invoke('update', { ...state, presentation: { ...state.presentation, opacity: NaN } }).ok).toBe(false);
    expect(bridge.updateFocusGlass).not.toHaveBeenCalled();
  });
  it('falls back when the module is unavailable or an update fails', () => {
    const { invoke, bridge } = setup();
    bridge.startFocusGlass.mockReturnValue(false);
    expect(invoke('start')).toEqual({ ok: true, data: false });
    bridge.startFocusGlass.mockReturnValue(true);
    invoke('start');
    bridge.updateFocusGlass.mockImplementation(() => { throw new Error('surface lost'); });
    expect(invoke('update', state).ok).toBe(false);
    expect(invoke('update', state).ok).toBe(false);
  });
  it('validates labels and finite playback values before crossing the native boundary', () => {
    expect(focusGlassStateSchema.safeParse(state).success).toBe(true);
    expect(focusGlassStateSchema.safeParse({ ...state, currentTime: NaN }).success).toBe(false);
    expect(focusGlassStateSchema.safeParse({ ...state, backdropLuminance: 2 }).success).toBe(false);
    expect(focusGlassStateSchema.safeParse({ ...state, labels: { ...state.labels, mute: 'x'.repeat(129) } }).success).toBe(false);
  });
  it('overrides the placeholder luminance with the analyzed cover and clears it on stop', async () => {
    const { invoke, bridge, owner } = setup();
    invoke('start');
    mocks.netFetch.mockResolvedValue({ ok: true, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(8) });
    mocks.createFromBuffer.mockImplementation(whiteCoverImage);
    await invoke('backdrop', { source: 'cover://x/1?size=256' });
    expect(owner.send).toHaveBeenCalledTimes(1);
    const [channel, payload] = owner.send.mock.calls[0] as unknown as [string, { luminance: number }];
    expect(channel).toBe('focus-glass-backdrop');
    expect(payload.luminance).toBeCloseTo(1);
    invoke('update', state);
    const forwarded = bridge.updateFocusGlass.mock.calls[0]![0] as FocusGlassState;
    expect(forwarded.backdropLuminance).toBeCloseTo(1);
    invoke('stop');
    invoke('start');
    invoke('update', state);
    const afterReset = bridge.updateFocusGlass.mock.calls[1]![0] as FocusGlassState;
    expect(afterReset.backdropLuminance).toBe(-1);
  });
  it('reports an unknown luminance without a cover and caches repeat analyses', async () => {
    const { invoke, owner } = setup();
    await invoke('backdrop', { source: null });
    expect(owner.send).toHaveBeenCalledWith('focus-glass-backdrop', { luminance: null });
    mocks.netFetch.mockResolvedValue({ ok: true, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(8) });
    mocks.createFromBuffer.mockImplementation(whiteCoverImage);
    await invoke('backdrop', { source: 'cover://x/2?size=256' });
    await invoke('backdrop', { source: 'cover://x/2?size=256' });
    expect(mocks.netFetch).toHaveBeenCalledOnce();
  });
  it('degrades to the theme fallback when a cover cannot be fetched or decoded', async () => {
    const { invoke, bridge } = setup();
    mocks.netFetch.mockRejectedValue(new Error('offline'));
    await invoke('backdrop', { source: 'https://cdn.example/cover.jpg' });
    expect(bridge.updateFocusGlass).not.toHaveBeenCalled();
    invoke('start');
    invoke('update', state);
    expect(bridge.updateFocusGlass).toHaveBeenCalledWith(state);
    mocks.netFetch.mockResolvedValue({ ok: true, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(8) });
    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => true });
    await invoke('backdrop', { source: 'cover://x/broken' });
    expect(invoke('update', state).ok).toBe(true);
    expect(bridge.updateFocusGlass).toHaveBeenLastCalledWith(state);
  });
});
