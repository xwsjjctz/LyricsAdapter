// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), warn: vi.fn(),
  primary: vi.fn(), matching: vi.fn(),
}));
vi.mock('../../electron/services/settingsStore', () => ({ settingsStore: { get: mocks.get, set: mocks.set } }));
vi.mock('../../electron/logger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('electron', () => ({ screen: { getPrimaryDisplay: mocks.primary, getDisplayMatching: mocks.matching } }));

import { applyWindowPreset, fitWindowSize, getInitialWindowState, rememberWindowState, WINDOW_STATE_KEY } from '../../electron/services/windowState';

function windowStub() {
  const state = { normal: { x: 100, y: 100, width: 720, height: 700 },
    bounds: { x: 100, y: 100, width: 720, height: 700 },
    maximized: false, minimized: false, fullscreen: false, destroyed: false };
  const stub = Object.assign(new EventEmitter(), {
    isDestroyed: () => state.destroyed, getNormalBounds: () => state.normal,
    getBounds: () => state.bounds, isMaximized: () => state.maximized,
    isMinimized: () => state.minimized, isFullScreen: () => state.fullscreen,
    setBounds: vi.fn(), setMinimumSize: vi.fn(), setFullScreen: vi.fn(),
    unmaximize: vi.fn(), restore: vi.fn(), show: vi.fn(), focus: vi.fn(),
  });
  return { state, stub, window: stub as unknown as BrowserWindow };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  mocks.get.mockReturnValue(undefined); mocks.set.mockReturnValue(true);
  mocks.primary.mockReturnValue({ workAreaSize: { width: 1728, height: 970 } });
  mocks.matching.mockReturnValue({ workArea: { x: 0, y: 30, width: 1728, height: 970 } });
});
afterEach(() => vi.useRealTimers());

describe('window size persistence and presets', () => {
  it('restores a custom size and zoom state before creating the window', () => {
    mocks.get.mockReturnValue(JSON.stringify({ width: 734, height: 812, maximized: true }));
    expect(getInitialWindowState()).toEqual({ width: 734, height: 812, minWidth: 360, minHeight: 600, maximized: true });
    expect(mocks.get).toHaveBeenCalledWith(WINDOW_STATE_KEY);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it.each(['not json', 'null', '{"width":-1,"height":800}', '{"width":480}'])('falls back safely for invalid saved data: %s', raw => {
    mocks.get.mockReturnValue(raw);
    expect(getInitialWindowState()).toEqual({ width: 1200, height: 800, minWidth: 360, minHeight: 600, maximized: false });
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('fits oversized saved windows and minimum constraints to a smaller display', () => {
    mocks.get.mockReturnValue('{"width":2500,"height":1800}');
    mocks.primary.mockReturnValue({ workAreaSize: { width: 800, height: 500 } });
    expect(getInitialWindowState()).toEqual({ width: 800, height: 500, minWidth: 360, minHeight: 500, maximized: false });
    expect(fitWindowSize({ width: 20, height: 40 }, { width: 1728, height: 970 })).toEqual({ width: 360, height: 600 });
  });
  it('debounces a resize gesture and flushes the last size immediately on close', () => {
    const { window, state } = windowStub(); rememberWindowState(window);
    for (const width of [500, 600, 734]) { state.normal.width = width; window.emit('resize'); vi.advanceTimersByTime(100); }
    expect(mocks.set).not.toHaveBeenCalled();
    window.emit('close');
    expect(mocks.set).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.set.mock.calls[0]![1])).toEqual({ width: 734, height: 700, maximized: false });
    vi.advanceTimersByTime(500); expect(mocks.set).toHaveBeenCalledOnce();
  });
  it('saves normal bounds while zoomed/fullscreen and retries a failed final write', () => {
    const { window, state } = windowStub(); rememberWindowState(window);
    state.bounds = { x: 0, y: 0, width: 1728, height: 970 }; state.maximized = true;
    mocks.set.mockReturnValueOnce(false);
    window.emit('maximize'); vi.advanceTimersByTime(250);
    window.emit('close');
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.set.mock.calls[1]![1])).toEqual({ width: 720, height: 700, maximized: true });
    state.fullscreen = true; window.emit('resize'); vi.advanceTimersByTime(250);
    expect(mocks.set).toHaveBeenCalledTimes(2);
  });
  it('cancels a pending write when the native window is destroyed', () => {
    const { window, state } = windowStub(); rememberWindowState(window);
    window.emit('resize'); state.destroyed = true; window.emit('closed');
    vi.advanceTimersByTime(500); expect(mocks.set).not.toHaveBeenCalled();
  });
  it('centers a preset on the current display and keeps it within the work area', () => {
    const { window, stub } = windowStub();
    applyWindowPreset(window, 'portrait');
    expect(stub.setBounds).toHaveBeenCalledWith({ x: 268, y: 50, width: 385, height: 800 });
    mocks.matching.mockReturnValue({ workArea: { x: -1024, y: 0, width: 1024, height: 768 } });
    applyWindowPreset(window, 'landscape');
    expect(stub.setBounds).toHaveBeenLastCalledWith({ x: -1024, y: 0, width: 1024, height: 768 });
  });
  it('waits for fullscreen and zoom exit, applying only the latest queued preset', () => {
    const { window, state, stub } = windowStub(); state.fullscreen = true; state.maximized = true;
    applyWindowPreset(window, 'portrait'); applyWindowPreset(window, 'landscape');
    expect(stub.setFullScreen).toHaveBeenCalledExactlyOnceWith(false);
    expect(stub.setBounds).not.toHaveBeenCalled();
    state.fullscreen = false; window.emit('leave-full-screen');
    expect(stub.unmaximize).toHaveBeenCalledOnce(); expect(stub.setBounds).not.toHaveBeenCalled();
    state.maximized = false; window.emit('unmaximize');
    expect(stub.setBounds).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 50, width: 1200, height: 800 });
  });
});
