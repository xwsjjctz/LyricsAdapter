import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  deleteSetting: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  isDesktop: vi.fn(),
}));

vi.mock('@/services/appStorage', () => ({
  appStorage: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
  },
}));

vi.mock('@/services/indexedDBStorage', () => ({
  indexedDBStorage: {
    getSetting: mocks.getSetting,
    setSetting: mocks.setSetting,
    deleteSetting: mocks.deleteSetting,
  },
}));

vi.mock('@/services/logger', () => ({ logger: mocks.logger }));
vi.mock('@/services/desktopAdapter', () => ({ isDesktop: mocks.isDesktop }));

async function loadModule() {
  return import('@/services/playlistOverrides');
}

describe('playlistOverrides persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getItem.mockReturnValue(null);
    mocks.setItem.mockResolvedValue(undefined);
    mocks.getSetting.mockResolvedValue(null);
    mocks.setSetting.mockResolvedValue(undefined);
    mocks.deleteSetting.mockResolvedValue(undefined);
    mocks.isDesktop.mockReturnValue(true);
  });

  it('uses AppStorage as the authority and removes the retired IDB value', async () => {
    const stored = { 'qq:1': { name: 'Renamed' } };
    mocks.getItem.mockReturnValue(JSON.stringify(stored));
    const { loadOverrides } = await loadModule();

    await expect(loadOverrides()).resolves.toEqual(stored);

    expect(mocks.getSetting).not.toHaveBeenCalled();
    expect(mocks.deleteSetting).toHaveBeenCalledWith('playlist-overrides');
  });

  it('repairs invalid AppStorage overrides from valid legacy IDB before cleanup', async () => {
    const stored = { 'qq:9': { name: 'Recovered', hidden: false } };
    const legacy = JSON.stringify(stored);
    mocks.getItem.mockReturnValue('{"qq:9":{"hidden":"yes"}}');
    mocks.getSetting.mockResolvedValue(legacy);
    const { loadOverrides } = await loadModule();

    await expect(loadOverrides()).resolves.toEqual(stored);

    expect(mocks.setItem).toHaveBeenCalledWith('playlist-overrides', legacy);
    expect(mocks.deleteSetting).toHaveBeenCalledWith('playlist-overrides');
    expect(mocks.setItem.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteSetting.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['array map', '[]'],
    ['non-object entry', '{"qq:1":"renamed"}'],
    ['invalid field type', '{"qq:1":{"name":42,"hidden":false}}'],
  ])('does not delete IDB when the target has an %s and legacy data is invalid', async (_name, stored) => {
    mocks.getItem.mockReturnValue(stored);
    mocks.getSetting.mockResolvedValue('{"qq:1":{"coverUrl":null}}');
    const { loadOverrides } = await loadModule();

    await expect(loadOverrides()).resolves.toEqual({});

    expect(mocks.setItem).not.toHaveBeenCalled();
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
  });

  it('migrates the legacy IDB value after the AppStorage write succeeds', async () => {
    const stored = { 'netease:2': { hidden: true } };
    const raw = JSON.stringify(stored);
    mocks.getSetting.mockResolvedValue(raw);
    const { loadOverrides } = await loadModule();

    await expect(loadOverrides()).resolves.toEqual(stored);

    expect(mocks.setItem).toHaveBeenCalledWith('playlist-overrides', raw);
    expect(mocks.deleteSetting).toHaveBeenCalledWith('playlist-overrides');
    expect(mocks.setItem.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteSetting.mock.invocationCallOrder[0],
    );
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it('keeps using the legacy value without deleting it when migration fails', async () => {
    const stored = { 'qq:3': { coverUrl: 'data:image/png;base64,abc' } };
    mocks.getSetting.mockResolvedValue(JSON.stringify(stored));
    mocks.setItem.mockRejectedValue(new Error('settings unavailable'));
    const { loadOverrides } = await loadModule();

    await expect(loadOverrides()).resolves.toEqual(stored);

    expect(mocks.deleteSetting).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalled();
  });

  it('persists edits through AppStorage without writing IDB', async () => {
    mocks.getItem.mockReturnValue('{}');
    const { setOverride } = await loadModule();

    const result = await setOverride('qq', '4', { name: 'My playlist' });

    expect(result).toEqual({ 'qq:4': { name: 'My playlist' } });
    expect(mocks.setItem).toHaveBeenCalledWith(
      'playlist-overrides',
      JSON.stringify({ 'qq:4': { name: 'My playlist' } }),
    );
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it('keeps browser overrides and base64 covers in IndexedDB', async () => {
    mocks.isDesktop.mockReturnValue(false);
    mocks.getSetting.mockResolvedValue('{}');
    const { setOverride } = await loadModule();

    await setOverride('qq', 'browser', { coverUrl: 'data:image/png;base64,abc' });

    expect(mocks.setSetting).toHaveBeenCalledWith(
      'playlist-overrides',
      JSON.stringify({ 'qq:browser': { coverUrl: 'data:image/png;base64,abc' } }),
    );
    expect(mocks.setItem).not.toHaveBeenCalled();
  });
});
