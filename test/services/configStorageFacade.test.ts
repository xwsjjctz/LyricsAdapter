import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/appStorage', () => ({
  appStorage: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
  },
}));

vi.mock('@/services/logger', () => ({ logger: mocks.logger }));

describe('configuration storage facade', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getItem.mockReturnValue(null);
    mocks.setItem.mockResolvedValue(undefined);
  });

  it('routes theme persistence only through AppStorage', async () => {
    const { themeManager } = await import('@/services/themeManager');
    const theme = themeManager.getAllThemes().find(({ id }) => id !== themeManager.getCurrentThemeId());
    expect(theme).toBeDefined();

    themeManager.setTheme(theme!.id);

    expect(mocks.setItem).toHaveBeenCalledWith('app-theme', theme!.id);
    expect(localStorage.getItem('app-theme')).toBeNull();
  });

  it('routes shortcut persistence only through AppStorage', async () => {
    const { shortcutManager } = await import('@/services/shortcuts');

    expect(shortcutManager.updateShortcut('playPause', 'Ctrl+Shift+P')).toBe(true);

    expect(mocks.setItem).toHaveBeenCalledWith('app-shortcuts', expect.any(String));
    expect(localStorage.getItem('app-shortcuts')).toBeNull();
  });

  it('routes language persistence only through AppStorage', async () => {
    const { default: i18n } = await import('@/i18n');
    mocks.setItem.mockClear();

    await i18n.changeLanguage('en');

    expect(mocks.setItem).toHaveBeenCalledWith('app-language', 'en');
    expect(localStorage.getItem('app-language')).toBeNull();
  });
});
