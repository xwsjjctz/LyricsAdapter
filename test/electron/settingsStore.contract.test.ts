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

import { settingsStore } from '../../electron/services/settingsStore';

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
});
