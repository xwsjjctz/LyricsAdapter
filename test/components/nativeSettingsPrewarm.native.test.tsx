import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeSettingsPrewarm } from '@/components/settings/SettingsSurface';
import { nativeSettingsOwnsKeyboard } from '@/services/nativeSettingsFocus';
import { musicPluginStore } from '@/stores/musicPluginStore';
import type { NativeSettingsState } from '@/types/nativeSettings';

const mocks = vi.hoisted(() => {
  const api = { start: vi.fn(), update: vi.fn(), stop: vi.fn(), onAction: vi.fn() };
  return { api, desktop: { platform: 'darwin', osRelease: '25.1.0', ipc: { nativeSettings: api } } };
});
vi.mock('@/services/desktopAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/desktopAdapter')>(),
  getDesktopAPI: () => mocks.desktop,
}));

const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.desktop.osRelease = '25.1.0';
  mocks.api.start.mockResolvedValue({ ok: true, data: true });
  mocks.api.update.mockResolvedValue({ ok: true });
  mocks.api.stop.mockResolvedValue({ ok: true });
  mocks.api.onAction.mockReturnValue(vi.fn());
  musicPluginStore.setState({ plugins: [], loaded: true, error: '' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Runs first: once a sheet is built, the page never builds another.
it('builds nothing on macOS before 26', async () => {
  mocks.desktop.osRelease = '24.6.0';
  render(<NativeSettingsPrewarm />);
  await settle(10_000);
  expect(mocks.api.start).not.toHaveBeenCalled();
});

it('builds the hidden sheet once the app has settled, then lets React go', async () => {
  let applied: (value: { ok: true }) => void = () => {};
  mocks.api.update.mockReturnValueOnce(new Promise(resolve => { applied = resolve; }));
  const view = render(<NativeSettingsPrewarm />);
  await settle(3000);
  expect(mocks.api.start).not.toHaveBeenCalled();
  await settle(1500);
  vi.useRealTimers();
  await waitFor(() => expect(mocks.api.update).toHaveBeenCalled());
  // Built but never shown: nothing in the page dims the wall or takes the keyboard.
  expect(mocks.api.update.mock.calls.map(call => (call[0] as NativeSettingsState).open)).not.toContain(true);
  expect(view.container.querySelector('.settings-sheet-backdrop')).toBeNull();
  expect(nativeSettingsOwnsKeyboard()).toBe(false);

  // Once AppKit holds the views, the React side stops; AppKit keeps the hidden sheet.
  await act(async () => { applied({ ok: true }); });
  await waitFor(() => expect(mocks.api.stop).toHaveBeenCalledTimes(1));
  expect(mocks.api.start).toHaveBeenCalledTimes(1);

  // A later mount, e.g. after settings closed, does not build it again.
  view.unmount();
  vi.useFakeTimers();
  render(<NativeSettingsPrewarm />);
  await settle(10_000);
  expect(mocks.api.start).toHaveBeenCalledTimes(1);
});
