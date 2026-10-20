import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsSurface from '@/components/settings/SettingsSurface';
import { settingsManager } from '@/services/settingsManager';
import { shortcutManager } from '@/services/shortcuts';
import { musicPluginStore } from '@/stores/musicPluginStore';
import type { NativeSettingsAction, NativeSettingsControl, NativeSettingsState } from '@/types/nativeSettings';

const mocks = vi.hoisted(() => {
  const api = { start: vi.fn(), update: vi.fn(), stop: vi.fn(), onAction: vi.fn() };
  // One stable bridge object, like the real desktop adapter.
  const desktop = { platform: 'darwin', osRelease: '25.1.0', ipc: { nativeSettings: api } };
  return { api, desktop, unsubscribe: vi.fn() };
});
vi.mock('@/services/desktopAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/desktopAdapter')>(),
  getDesktopAPI: () => mocks.desktop,
}));

const lastState = () => mocks.api.update.mock.calls.at(-1)![0] as NativeSettingsState;
const findControl = (state: NativeSettingsState, id: string) => state.sections
  .flatMap(section => section.blocks).flatMap(block => [...block.headingControls, ...block.rows.flatMap(row => row.controls)])
  .find(item => 'id' in item && item.id === id) as Extract<NativeSettingsControl, { id: string }> | undefined;
const emit = (action: Partial<NativeSettingsAction> & Pick<NativeSettingsAction, 'type'>) =>
  act(() => (mocks.api.onAction.mock.calls[0]![0] as (a: NativeSettingsAction) => void)({ id: '', value: 0, text: '', code: '', ...action }));

async function open(onClose = vi.fn()) {
  const view = render(<SettingsSurface initialSection="general" onClose={onClose} onPreviewWelcome={vi.fn()} />);
  await waitFor(() => expect(mocks.api.update).toHaveBeenCalled());
  return { view, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.desktop.platform = 'darwin';
  mocks.desktop.osRelease = '25.1.0';
  mocks.api.start.mockResolvedValue({ ok: true, data: true });
  mocks.api.update.mockResolvedValue({ ok: true });
  mocks.api.stop.mockResolvedValue({ ok: true });
  mocks.api.onAction.mockReturnValue(mocks.unsubscribe);
  musicPluginStore.setState({ plugins: [], loaded: true, error: '' });
  shortcutManager.resetAllToDefaults();
});
afterEach(() => { cleanup(); shortcutManager.resetAllToDefaults(); vi.restoreAllMocks(); });

describe('settings on macOS 26 native glass', () => {
  it('leaves only the dimming backdrop in the page and hands every section to AppKit', async () => {
    const { view } = await open();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(view.container.querySelector('.settings-sheet-backdrop')).toHaveAttribute('data-native-settings', 'true');
    const state = lastState();
    expect(state).toMatchObject({ open: true, reveal: { section: 'general', token: 0 }, dialog: null });
    expect(state.sections.map(section => section.id)).toEqual(['general', 'plugins', 'cloud', 'focus', 'shortcuts']);
    expect(findControl(state, 'general:language')).toMatchObject({ type: 'popup' });
  });

  it('closes from AppKit and stops the sheet when unmounted', async () => {
    const { view, onClose } = await open();
    emit({ type: 'close' });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.api.stop).toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it('keeps the WebDAV draft in React and marks its section unsaved', async () => {
    await open();
    emit({ type: 'field', id: 'cloud:url', text: 'https://dav.example' });
    await waitFor(() => expect(findControl(lastState(), 'cloud:url')).toMatchObject({ value: 'https://dav.example' }));
    expect(lastState().sections.find(section => section.id === 'cloud')!.unsaved).toBe(true);
  });

  it('applies Focus Mode sliders as they move', async () => {
    const setFontSize = vi.spyOn(settingsManager, 'setFocusLyricsFontSize').mockResolvedValue(undefined as never);
    await open();
    emit({ type: 'slider', id: 'focus:font-size', value: 36 });
    expect(setFontSize).toHaveBeenCalledWith(36);
  });

  it('records a shortcut from keys AppKit forwards', async () => {
    await open();
    emit({ type: 'record', id: 'shortcut:toggleFocusMode' });
    await waitFor(() => expect(findControl(lastState(), 'shortcut:toggleFocusMode')).toMatchObject({ recording: true }));
    emit({ type: 'record-key', id: 'shortcut:toggleFocusMode', text: 'L', code: 'KeyL', value: 1 | 8 });
    expect(shortcutManager.getShortcut('toggleFocusMode').currentKey).toBe('CmdOrCtrl+Shift+L');
    await waitFor(() => expect(findControl(lastState(), 'shortcut:toggleFocusMode')).toMatchObject({ recording: false, state: 'custom' }));
  });

  it('asks before resetting every shortcut', async () => {
    await open();
    emit({ type: 'button', id: 'shortcuts:reset-all' });
    await waitFor(() => expect(lastState().dialog).toMatchObject({ destructive: false, busy: false }));
    emit({ type: 'dialog', text: 'cancel' });
    await waitFor(() => expect(lastState().dialog).toBeNull());
  });

  it('falls back to the web sheet when AppKit cannot take over', async () => {
    mocks.api.start.mockResolvedValue({ ok: true, data: false });
    render(<SettingsSurface initialSection="general" onClose={vi.fn()} onPreviewWelcome={vi.fn()} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(mocks.api.update).not.toHaveBeenCalled();
  });

  it('keeps older macOS and other platforms on the web sheet', () => {
    mocks.desktop.osRelease = '24.6.0';
    const older = render(<SettingsSurface initialSection="general" onClose={vi.fn()} onPreviewWelcome={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    older.unmount();
    mocks.desktop.platform = 'win32';
    mocks.desktop.osRelease = '10.0.26100';
    render(<SettingsSurface initialSection="general" onClose={vi.fn()} onPreviewWelcome={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.api.start).not.toHaveBeenCalled();
  });
});
