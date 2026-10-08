// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  repository: {
    directoryPath: '/virtual-home/.la',
    initialize: vi.fn(),
    getSetting: vi.fn(),
    getAllSettings: vi.fn(),
    setSetting: vi.fn(),
    setManySettings: vi.fn(),
    deleteSetting: vi.fn(),
    replaceAllSettings: vi.fn(),
  },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../electron/services/userStateRepository', () => ({
  userStateRepository: mocks.repository,
}));
vi.mock('../../electron/logger', () => ({ logger: mocks.logger }));

import { SettingsStore, settingsStore } from '../../electron/services/settingsStore';

describe('SettingsStore SQLite compatibility facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.getAllSettings.mockReturnValue({
      'app-theme': 'default-dark',
      playback: '{"volume":0.5}',
    });
    mocks.repository.getSetting.mockImplementation((key: string) => (
      key === 'app-theme' ? 'default-dark' : undefined
    ));
  });

  it('initializes the shared repository and reports the stable ~/.la directory', () => {
    settingsStore.initialize();

    expect(mocks.repository.initialize).toHaveBeenCalledOnce();
    expect(settingsStore.getDirectoryPath()).toBe('/virtual-home/.la');
  });

  it('preserves the existing synchronous read surface', () => {
    expect(settingsStore.get('app-theme')).toBe('default-dark');
    expect(settingsStore.get('missing')).toBeUndefined();
    expect(settingsStore.getAll()).toEqual({
      'app-theme': 'default-dark',
      playback: '{"volume":0.5}',
    });
  });

  it('delegates all mutations to the SQLite repository', () => {
    expect(settingsStore.set('app-theme', 'default-light')).toBe(true);
    expect(settingsStore.setMany({ 'app-language': 'zh', playback: '{}' })).toBe(true);
    expect(settingsStore.delete('app-language')).toBe(true);
    expect(settingsStore.replaceAll({ 'app-theme': 'default-dark' })).toBe(true);

    expect(mocks.repository.setSetting).toHaveBeenCalledWith('app-theme', 'default-light');
    expect(mocks.repository.setManySettings).toHaveBeenCalledWith({
      'app-language': 'zh',
      playback: '{}',
    });
    expect(mocks.repository.deleteSetting).toHaveBeenCalledWith('app-language');
    expect(mocks.repository.replaceAllSettings).toHaveBeenCalledWith({
      'app-theme': 'default-dark',
    });
  });

  it.each([
    ['set', () => settingsStore.set('app-theme', 'default-light'), 'setSetting'],
    ['setMany', () => settingsStore.setMany({ 'app-theme': 'default-light' }), 'setManySettings'],
    ['delete', () => settingsStore.delete('app-theme'), 'deleteSetting'],
    ['replaceAll', () => settingsStore.replaceAll({}), 'replaceAllSettings'],
  ] as const)('reports false when %s cannot commit', (_name, invoke, method) => {
    mocks.repository[method].mockImplementationOnce(() => {
      throw new Error('database write failed');
    });

    expect(invoke()).toBe(false);
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  describe('sensitive settings that cannot be encrypted', () => {
    const refuse = () => { throw new Error('safeStorage is unavailable'); };

    it('keeps a refused secret for the session while still reporting it as not persisted', () => {
      const store = new SettingsStore();
      mocks.repository.setSetting.mockImplementationOnce(refuse);

      expect(store.set('netease_cookie', 'MUSIC_U=session')).toBe(false);
      expect(store.get('netease_cookie')).toBe('MUSIC_U=session');
      expect(store.getAll()).toMatchObject({ 'app-theme': 'default-dark', netease_cookie: 'MUSIC_U=session' });
      expect(new SettingsStore().get('netease_cookie')).toBeUndefined();
    });

    it('never keeps a non-sensitive value that failed to persist', () => {
      const store = new SettingsStore();
      mocks.repository.setSetting.mockImplementationOnce(refuse);

      expect(store.set('app-language', 'zh')).toBe(false);
      expect(store.get('app-language')).toBeUndefined();
    });

    it('persists the ordinary entries of a refused batch and keeps only its secrets in memory', () => {
      const store = new SettingsStore();
      mocks.repository.setManySettings.mockImplementationOnce(refuse);

      expect(store.setMany({ qq_music_cookie: 'uin=1', 'app-language': 'zh' })).toBe(false);
      expect(mocks.repository.setManySettings).toHaveBeenLastCalledWith({ 'app-language': 'zh' });
      expect(store.get('qq_music_cookie')).toBe('uin=1');
    });

    it('drops the session copy once the secret is persisted, deleted or replaced', () => {
      const store = new SettingsStore();
      const hold = () => {
        mocks.repository.setSetting.mockImplementationOnce(refuse);
        store.set('qq_music_cookie', 'uin=1');
      };

      hold();
      expect(store.set('qq_music_cookie', 'uin=2')).toBe(true);
      expect(store.get('qq_music_cookie')).toBeUndefined();
      hold();
      expect(store.setMany({ qq_music_cookie: 'uin=3' })).toBe(true);
      expect(store.get('qq_music_cookie')).toBeUndefined();
      hold();
      expect(store.delete('qq_music_cookie')).toBe(true);
      expect(store.get('qq_music_cookie')).toBeUndefined();
      hold();
      expect(store.replaceAll({ 'app-theme': 'default-dark' })).toBe(true);
      expect(store.get('qq_music_cookie')).toBeUndefined();
    });
  });
});
