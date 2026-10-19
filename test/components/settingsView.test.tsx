import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '@/components/settings/SettingsView';
import i18n from '@/services/i18n';
import { musicPluginStore } from '@/stores/musicPluginStore';

describe('SettingsView sheet', () => {
  beforeEach(() => {
    musicPluginStore.setState({ plugins: [], loaded: true, error: '' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const link = (key: string) => screen.getByRole('link', { name: new RegExp(i18n.t(key)) });

  it('opens on General and marks it in the bar', () => {
    render(<SettingsView onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: i18n.t('settings.title') })).toBeInTheDocument();
    expect(link('settings.nav.general')).toHaveAttribute('aria-current', 'location');
    expect(screen.getByRole('combobox', { name: i18n.t('settings.language') })).toBeInTheDocument();
  });

  it('lists every section at once, each under its own heading', () => {
    render(<SettingsView onClose={vi.fn()} />);
    expect(screen.getAllByRole('link').filter(element => element.classList.contains('settings-sheet__tab'))).toHaveLength(5);
    for (const key of ['settings.nav.general', 'settings.nav.plugins', 'settings.nav.cloud', 'settings.nav.experimental', 'settings.shortcuts.title']) {
      expect(screen.getByRole('region', { name: i18n.t(key) })).toBeInTheDocument();
    }
    expect(screen.getByRole('slider', { name: i18n.t('settings.focusLyricsFontSize') })).toBeInTheDocument();
    expect(screen.getByTestId('music-plugin-manager')).toBeInTheDocument();
  });

  it('jumps to a section from the bar', () => {
    render(<SettingsView onClose={vi.fn()} />);
    fireEvent.click(link('settings.nav.experimentalShort'));
    expect(link('settings.nav.experimentalShort')).toHaveAttribute('aria-current', 'location');
    expect(link('settings.nav.general')).not.toHaveAttribute('aria-current');
  });

  it('follows a new requested section while open', () => {
    const { rerender } = render(<SettingsView initialSection="general" onClose={vi.fn()} />);
    rerender(<SettingsView initialSection="focus" onClose={vi.fn()} />);
    expect(link('settings.nav.experimentalShort')).toHaveAttribute('aria-current', 'location');
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
