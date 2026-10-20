import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from '@/components/settings/SettingsView';
import i18n from '@/services/i18n';
import { musicPluginStore } from '@/stores/musicPluginStore';

const mocks = vi.hoisted(() => ({
  desktop: { platform: 'darwin', coverCacheInfo: vi.fn(), clearCoverCache: vi.fn() },
}));
vi.mock('@/services/desktopAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/desktopAdapter')>(),
  getDesktopAPI: () => mocks.desktop,
}));

describe('cover cache setting', () => {
  beforeEach(() => {
    musicPluginStore.setState({ plugins: [], loaded: true, error: '' });
    mocks.desktop.platform = 'darwin';
    mocks.desktop.coverCacheInfo.mockResolvedValue({ entries: 4, bytes: 3 * 1024 * 1024 });
    mocks.desktop.clearCoverCache.mockResolvedValue({ entries: 0, bytes: 0 });
  });
  afterEach(() => { vi.clearAllMocks(); });

  const clearButton = () => screen.getByRole('button', { name: i18n.t('settings.coverCacheClear') });

  it('shows the size on disk and empties the cache', async () => {
    render(<SettingsView onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('cover-cache-size')).toHaveTextContent('3.0 MiB'));
    expect(screen.getByText(i18n.t('settings.coverCache'))).toBeInTheDocument();
    expect(clearButton()).toBeEnabled();
    fireEvent.click(clearButton());
    await waitFor(() => expect(screen.getByTestId('cover-cache-size')).toHaveTextContent('0 B'));
    expect(mocks.desktop.clearCoverCache).toHaveBeenCalledTimes(1);
    expect(clearButton()).toBeDisabled();
  });

  it('says so when clearing fails, and lets it be tried again', async () => {
    mocks.desktop.clearCoverCache.mockRejectedValue(new Error('EACCES'));
    render(<SettingsView onClose={vi.fn()} />);
    await waitFor(() => expect(clearButton()).toBeEnabled());
    fireEvent.click(clearButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.coverCacheClearFailed'));
    expect(clearButton()).toBeEnabled();
  });

  it('stays out of the sheet where nothing uses the cache', async () => {
    mocks.desktop.platform = 'win32';
    render(<SettingsView onClose={vi.fn()} />);
    await Promise.resolve();
    expect(screen.queryByTestId('cover-cache-size')).toBeNull();
    expect(mocks.desktop.coverCacheInfo).not.toHaveBeenCalled();
  });
});
