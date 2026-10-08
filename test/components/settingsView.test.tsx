import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '@/components/settings/SettingsView';
import i18n from '@/services/i18n';
import { settingsManager } from '@/services/settingsManager';
import { musicPluginStore } from '@/stores/musicPluginStore';

describe('SettingsView sheet', () => {
  beforeEach(() => {
    vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(false);
    musicPluginStore.setState({ plugins: [], loaded: true, error: '' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens on General and marks the current tab', () => {
    render(<SettingsView onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: i18n.t('settings.title') })).toBeInTheDocument();
    const general = screen.getByRole('tab', { name: new RegExp(i18n.t('settings.nav.general')) });
    expect(general).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: i18n.t('settings.language') })).toBeInTheDocument();
  });

  it('switches to another section from the tabs', () => {
    render(<SettingsView onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(i18n.t('settings.nav.focus')) }));

    expect(screen.getByRole('tabpanel', { name: i18n.t('settings.nav.focus') })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: i18n.t('settings.focusLyricsFontSize') })).toBeInTheDocument();
  });

  it('follows a new requested section while open', () => {
    const { rerender } = render(<SettingsView initialSection="general" onClose={vi.fn()} />);
    rerender(<SettingsView initialSection="focus" onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: new RegExp(i18n.t('settings.nav.focus')) })).toHaveAttribute('aria-selected', 'true');
  });

  it('turns online music on from its section', () => {
    musicPluginStore.setState({ plugins: [{ id: 'netease', name: 'NetEase', version: '1.0.0', apiVersion: 1, main: 'index.cjs', requiresCookie: false, capabilities: ['search'], enabled: true, origin: 'installed' }] });
    const setEnabled = vi.spyOn(settingsManager, 'setQqMusicEnabled').mockResolvedValue(true);
    render(<SettingsView initialSection="online" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('switch', { name: i18n.t('settings.qqMusicEnabled') }));

    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it('shows a dedicated plugin page and hides online settings without installed plugins', () => {
    render(<SettingsView initialSection="online" onClose={vi.fn()} />);
    expect(screen.queryByRole('tab', { name: new RegExp(i18n.t('settings.nav.online')) })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: new RegExp(i18n.t('settings.nav.plugins')) })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('music-plugin-manager')).toBeInTheDocument();
  });

  it('closes with Esc, the close button, or a click outside', () => {
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.close') }));
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('keeps clicks inside the sheet from closing it', () => {
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
