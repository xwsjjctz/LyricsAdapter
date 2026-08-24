import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storageInit: vi.fn(),
  storageGetItem: vi.fn(),
  storageSetMany: vi.fn(),
  idbInitialize: vi.fn(),
  idbGetSetting: vi.fn(),
  idbDeleteSetting: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/appStorage', () => ({
  appStorage: {
    init: mocks.storageInit,
    getItem: mocks.storageGetItem,
    setMany: mocks.storageSetMany,
  },
}));

vi.mock('@/services/indexedDBStorage', () => ({
  indexedDBStorage: {
    initialize: mocks.idbInitialize,
    getSetting: mocks.idbGetSetting,
    deleteSetting: mocks.idbDeleteSetting,
  },
}));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: vi.fn(() => null),
  getDesktopAPIAsync: vi.fn(async () => null),
}));

vi.mock('@/services/logger', () => ({ logger: mocks.logger }));

const STORAGE_KEY = 'contract_cookie';
const CHECK_TIME_KEY = 'contract_cookie_last_check';

async function createLoadedStore(cookie: string, checkTime: string) {
  mocks.storageGetItem.mockImplementation((key: string) => {
    if (key === STORAGE_KEY) return cookie;
    if (key === CHECK_TIME_KEY) return checkTime;
    // The module also constructs its two application singletons. Treat those
    // unrelated stores as explicitly empty so they do not enter IDB migration.
    return '';
  });

  const module = await import('@/services/cookieManager');
  await Promise.all([
    module.cookieManager.ensureLoaded(),
    module.neteaseCookieManager.ensureLoaded(),
  ]);
  mocks.storageSetMany.mockClear();

  const store = new module.CookieStore({
    storageKey: STORAGE_KEY,
    checkTimeKey: CHECK_TIME_KEY,
    scope: 'PersistenceContract',
    validate: vi.fn(async () => ({ valid: true })),
  });
  await store.ensureLoaded();
  mocks.storageSetMany.mockClear();
  return store;
}

describe('CookieStore durable-write contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.storageInit.mockResolvedValue(undefined);
    mocks.storageSetMany.mockResolvedValue(undefined);
    mocks.idbInitialize.mockResolvedValue(undefined);
    mocks.idbGetSetting.mockResolvedValue(null);
    mocks.idbDeleteSetting.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not publish a new cookie or check time when setCookie persistence fails', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000_000);
    const store = await createLoadedStore('old=value', '0');
    const listener = vi.fn();
    store.subscribe(listener);
    const failure = new Error('settings disk full');
    mocks.storageSetMany.mockRejectedValueOnce(failure);

    await expect(store.setCookie('new=value')).rejects.toBe(failure);

    expect(mocks.storageSetMany).toHaveBeenCalledWith({
      [STORAGE_KEY]: 'new=value',
      [CHECK_TIME_KEY]: '100000000',
    });
    expect(store.getCookie()).toBe('old=value');
    expect(store.hasCookie()).toBe(true);
    expect(store.shouldCheckCookie()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not clear the in-memory cookie or check time when clearCookie persistence fails', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const store = await createLoadedStore('old=value', '9000');
    const listener = vi.fn();
    store.subscribe(listener);
    const failure = new Error('settings disk full');
    mocks.storageSetMany.mockRejectedValueOnce(failure);

    await expect(store.clearCookie()).rejects.toBe(failure);

    expect(mocks.storageSetMany).toHaveBeenCalledWith({
      [STORAGE_KEY]: '',
      [CHECK_TIME_KEY]: '0',
    });
    expect(store.getCookie()).toBe('old=value');
    expect(store.hasCookie()).toBe(true);
    expect(store.shouldCheckCookie()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("persists cookie='' and checkTime='0' before clearing memory", async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const store = await createLoadedStore('old=value', '9000');

    await expect(store.clearCookie()).resolves.toBeUndefined();

    expect(mocks.storageSetMany).toHaveBeenCalledTimes(1);
    expect(mocks.storageSetMany).toHaveBeenCalledWith({
      [STORAGE_KEY]: '',
      [CHECK_TIME_KEY]: '0',
    });
    expect(store.getCookie()).toBe('');
    expect(store.hasCookie()).toBe(false);
    expect(store.shouldCheckCookie()).toBe(true);
  });

  it('notifies subscribers after durable login and logout changes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const store = await createLoadedStore('', '0');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.setCookie('new=value');
    await store.clearCookie();

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    await store.setCookie('newer=value');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
