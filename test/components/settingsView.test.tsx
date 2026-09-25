import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '@/components/settings/SettingsView';
import i18n from '@/services/i18n';
import { settingsManager } from '@/services/settingsManager';

describe('SettingsView', () => {
  beforeEach(() => {
    vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens on General and marks the current section', () => {
    render(<SettingsView />);
    const general = screen.getByRole('button', { name: new RegExp(i18n.t('settings.nav.general')) });
    expect(general).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('combobox', { name: i18n.t('settings.language') })).toBeInTheDocument();
  });

  it('switches to another section from the list', () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(i18n.t('settings.nav.focus')) }));

    expect(screen.getByRole('region', { name: i18n.t('settings.nav.focus') })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: i18n.t('settings.focusLyricsFontSize') })).toBeInTheDocument();
  });

  it('turns online music on from its section', () => {
    const setEnabled = vi.spyOn(settingsManager, 'setQqMusicEnabled').mockResolvedValue(true);
    render(<SettingsView initialSection="online" />);

    fireEvent.click(screen.getByRole('switch', { name: i18n.t('settings.qqMusicEnabled') }));

    expect(setEnabled).toHaveBeenCalledWith(true);
  });
});
