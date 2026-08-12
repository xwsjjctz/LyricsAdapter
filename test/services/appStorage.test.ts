import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDesktopAPIAsync: vi.fn(),
  isDesktop: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPIAsync: mocks.getDesktopAPIAsync,
  isDesktop: mocks.isDesktop,
}));

vi.mock('@/services/logger', () => ({ logger: mocks.logger }));

import { appStorage } from '@/services/appStorage';
import { SETTINGS_MIGRATION_VERSION, SETTINGS_MIGRATION_VERSION_KEY } from '@/shared/persistencePolicy';

const SENSITIVE_KEYS = [
  'webdav-config',
  'webdav-cdn-cache',
  'qq_music_cookie',
  'netease_cookie',
  'soda_cookie',
] as const;

function makeDesktopSettingsApi(initial: Record<string, string> = {}) {
  return {
    settingsGetAll: vi.fn().mockResolvedValue(initial),
    settingsSet: vi.fn().mockResolvedValue(undefined),
    settingsSetMany: vi.fn().mockResolvedValue(undefined),
    settingsDelete: vi.fn().mockResolvedValue(undefined),
    settingsReplaceAll: vi.fn().mockResolvedValue(undefined),
  };
}

describe('appStorage persistence boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    appStorage.clearCache();
  });

  it('keeps desktop secrets in memory/main-process storage and removes plaintext localStorage copies', async () => {
    const mainSettings = {
      'app-theme': 'default-dark',
      'webdav-config': '{"password":"webdav-secret"}',
      'webdav-cdn-cache': '{"/song.flac":{"url":"https://signed.example","expiry":1}}',
      qq_music_cookie: 'qq-secret',
      netease_cookie: 'netease-secret',
      soda_cookie: 'soda-secret',
    };
    const api = makeDesktopSettingsApi(mainSettings);

    for (const key of SENSITIVE_KEYS) {
      localStorage.setItem(key, `stale-${key}`);
    }
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);

    await appStorage.init();

    expect(localStorage.getItem('app-theme')).toBe('default-dark');
    for (const key of SENSITIVE_KEYS) {
      expect(appStorage.getItem(key)).toBe(mainSettings[key]);
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('treats a non-empty desktop snapshot as authoritative instead of resurrecting stale local keys', async () => {
    const api = makeDesktopSettingsApi({ 'app-theme': 'default-dark' });
    localStorage.setItem('la_floating_panel', 'true');
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);

    await appStorage.init();

    expect(appStorage.getItem('app-theme')).toBe('default-dark');
    expect(appStorage.getItem('la_floating_panel')).toBeNull();
    expect(localStorage.getItem('la_floating_panel')).toBeNull();
    expect(api.settingsSet).not.toHaveBeenCalledWith('la_floating_panel', 'true');
  });

  it('migrates only active allowlisted keys when the desktop store is empty', async () => {
    const api = makeDesktopSettingsApi();
    localStorage.setItem('app-theme', 'default-light');
    localStorage.setItem('webdav-config', '{"password":"legacy-secret"}');
    localStorage.setItem('la_new_ux_enabled', 'true');
    localStorage.setItem('unknown-stale-key', 'stale');
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);

    await appStorage.init();

    expect(appStorage.getItem('app-theme')).toBe('default-light');
    expect(appStorage.getItem('webdav-config')).toBe('{"password":"legacy-secret"}');
    expect(appStorage.getItem('la_new_ux_enabled')).toBeNull();
    expect(appStorage.getItem('unknown-stale-key')).toBeNull();
    expect(localStorage.getItem('app-theme')).toBe('default-light');
    expect(localStorage.getItem('webdav-config')).toBeNull();
    expect(api.settingsSetMany).toHaveBeenCalledWith({
      [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
      'app-theme': 'default-light',
      'webdav-config': '{"password":"legacy-secret"}',
    });
  });

  it('uses the migration marker to keep an intentionally empty desktop store authoritative', async () => {
    const api = makeDesktopSettingsApi({
      [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
    });
    localStorage.setItem('app-theme', 'stale-theme');
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);

    await appStorage.init();

    expect(appStorage.getItem('app-theme')).toBeNull();
    expect(localStorage.getItem('app-theme')).toBeNull();
    expect(api.settingsSetMany).not.toHaveBeenCalled();
  });

  it('migrates an early-read legacy secret without leaving a plaintext copy', async () => {
    const api = makeDesktopSettingsApi();
    localStorage.setItem('webdav-config', '{"password":"legacy-secret"}');
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);

    expect(appStorage.getItem('webdav-config')).toBeNull();
    expect(localStorage.getItem('webdav-config')).toBeNull();

    await appStorage.init();

    expect(appStorage.getItem('webdav-config')).toBe('{"password":"legacy-secret"}');
    expect(localStorage.getItem('webdav-config')).toBeNull();
    expect(api.settingsSetMany).toHaveBeenCalledWith(expect.objectContaining({
      'webdav-config': '{"password":"legacy-secret"}',
    }));
  });

  it('deduplicates concurrent initialization', async () => {
    const api = makeDesktopSettingsApi({ 'app-theme': 'default-dark' });
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);

    await Promise.all([appStorage.init(), appStorage.init(), appStorage.init()]);

    expect(api.settingsGetAll).toHaveBeenCalledTimes(1);
  });

  it('never falls back to a stale plaintext secret on a desktop cache miss', () => {
    mocks.isDesktop.mockReturnValue(true);
    localStorage.setItem('qq_music_cookie', 'stale-plaintext');

    expect(appStorage.getItem('qq_music_cookie')).toBeNull();
    expect(localStorage.getItem('qq_music_cookie')).toBeNull();
  });

  it.each(SENSITIVE_KEYS)('does not mirror desktop %s writes into localStorage', async (key) => {
    const api = makeDesktopSettingsApi();
    localStorage.setItem(key, 'stale-plaintext');
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);

    await appStorage.setItem(key, 'fresh-secret');

    expect(appStorage.getItem(key)).toBe('fresh-secret');
    expect(localStorage.getItem(key)).toBeNull();
    expect(api.settingsSet).toHaveBeenCalledWith(key, 'fresh-secret');
  });

  it('filters secrets from desktop setMany while retaining them in the synchronous cache', async () => {
    const api = makeDesktopSettingsApi();
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);

    await appStorage.setMany({
      'app-language': 'zh',
      qq_music_cookie: 'qq-secret',
      'webdav-config': '{"password":"secret"}',
    });

    expect(localStorage.getItem('app-language')).toBe('zh');
    expect(localStorage.getItem('qq_music_cookie')).toBeNull();
    expect(localStorage.getItem('webdav-config')).toBeNull();
    expect(appStorage.getItem('qq_music_cookie')).toBe('qq-secret');
    expect(api.settingsSetMany).toHaveBeenCalledWith({
      'app-language': 'zh',
      qq_music_cookie: 'qq-secret',
      'webdav-config': '{"password":"secret"}',
    });
  });

  it('replaceAll removes keys absent from the replacement and never leaves desktop secrets in localStorage', async () => {
    const api = makeDesktopSettingsApi();
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);
    localStorage.setItem('la_floating_panel', 'true');
    localStorage.setItem('unrelated-origin-data', 'keep-me');
    localStorage.setItem('qq_music_cookie', 'stale-secret');

    await appStorage.replaceAll({
      'app-language': 'en',
      netease_cookie: 'new-secret',
    });

    expect(localStorage.getItem('la_floating_panel')).toBeNull();
    expect(localStorage.getItem('unrelated-origin-data')).toBe('keep-me');
    expect(localStorage.getItem('qq_music_cookie')).toBeNull();
    expect(localStorage.getItem('netease_cookie')).toBeNull();
    expect(localStorage.getItem('app-language')).toBe('en');
    expect(appStorage.getItem('la_floating_panel')).toBeNull();
    expect(appStorage.getItem('netease_cookie')).toBe('new-secret');
    expect(api.settingsReplaceAll).toHaveBeenCalledWith({
      'app-language': 'en',
      netease_cookie: 'new-secret',
      [SETTINGS_MIGRATION_VERSION_KEY]: SETTINGS_MIGRATION_VERSION,
    });
  });

  it('rolls back optimistic desktop mutations when durable writes fail', async () => {
    const api = makeDesktopSettingsApi({ 'app-theme': 'default-dark', 'app-language': 'zh' });
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);
    await appStorage.init();

    api.settingsSet.mockRejectedValueOnce(new Error('disk full'));
    await expect(appStorage.setItem('app-theme', 'default-light')).rejects.toThrow('disk full');
    expect(appStorage.getItem('app-theme')).toBe('default-dark');
    expect(localStorage.getItem('app-theme')).toBe('default-dark');

    api.settingsSetMany.mockRejectedValueOnce(new Error('disk full'));
    await expect(appStorage.setMany({ 'app-theme': 'default-light', 'app-language': 'en' })).rejects.toThrow('disk full');
    expect(appStorage.getItem('app-theme')).toBe('default-dark');
    expect(appStorage.getItem('app-language')).toBe('zh');

    api.settingsDelete.mockRejectedValueOnce(new Error('disk full'));
    await expect(appStorage.removeItem('app-language')).rejects.toThrow('disk full');
    expect(appStorage.getItem('app-language')).toBe('zh');

    api.settingsReplaceAll.mockRejectedValueOnce(new Error('disk full'));
    await expect(appStorage.replaceAll({ 'app-language': 'ja' })).rejects.toThrow('disk full');
    expect(appStorage.getItem('app-theme')).toBe('default-dark');
    expect(appStorage.getItem('app-language')).toBe('zh');
  });

  it('never restores a stale plaintext secret while rolling back a failed desktop write', async () => {
    const api = makeDesktopSettingsApi();
    api.settingsSet.mockRejectedValueOnce(new Error('disk full'));
    mocks.isDesktop.mockReturnValue(true);
    mocks.getDesktopAPIAsync.mockResolvedValue(api);
    localStorage.setItem('webdav-config', '{"password":"stale-plaintext"}');

    await expect(appStorage.setItem('webdav-config', '{"password":"fresh"}')).rejects.toThrow('disk full');

    expect(localStorage.getItem('webdav-config')).toBeNull();
    expect(appStorage.getItem('webdav-config')).toBeNull();
  });

  it('uses localStorage as the complete plaintext fallback in browser mode', async () => {
    mocks.isDesktop.mockReturnValue(false);
    mocks.getDesktopAPIAsync.mockResolvedValue(null);
    localStorage.setItem('app-language', 'ja');
    localStorage.setItem('qq_music_cookie', 'browser-cookie');

    await appStorage.init();

    expect(appStorage.getItem('app-language')).toBe('ja');
    expect(appStorage.getItem('qq_music_cookie')).toBe('browser-cookie');

    await appStorage.setItem('webdav-config', '{"password":"browser-secret"}');
    expect(localStorage.getItem('webdav-config')).toBe('{"password":"browser-secret"}');

    await appStorage.replaceAll({ soda_cookie: 'browser-soda-cookie' });
    expect(localStorage.getItem('app-language')).toBeNull();
    expect(localStorage.getItem('qq_music_cookie')).toBeNull();
    expect(localStorage.getItem('webdav-config')).toBeNull();
    expect(localStorage.getItem('soda_cookie')).toBe('browser-soda-cookie');
    expect(mocks.getDesktopAPIAsync).not.toHaveBeenCalled();
  });
});
