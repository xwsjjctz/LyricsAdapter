import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QQCredential } from '@/shared/qqCredential';

const mocks = vi.hoisted(() => ({
  store: new Map<string, string>(),
  qqLoginRefresh: vi.fn(),
  setCookie: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('@/services/appStorage', () => ({
  appStorage: {
    init: vi.fn(async () => {}),
    getItem: (key: string) => mocks.store.get(key) ?? null,
    setItem: vi.fn(async (key: string, value: string) => { mocks.store.set(key, value); }),
  },
}));
vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPIAsync: vi.fn(async () => ({ qqLoginRefresh: mocks.qqLoginRefresh })),
}));
vi.mock('@/services/cookieManager', () => ({
  cookieManager: { ensureLoaded: vi.fn(async () => {}), getCookie: () => 'qm_keyst=old', setCookie: mocks.setCookie },
  syncOnlineCookiesToMain: mocks.sync,
}));
vi.mock('@/services/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { QQ_CREDENTIAL_STORAGE_KEY, qqCredentialManager } from '@/services/qqCredentialManager';

const HOUR = 60 * 60 * 1000;

function credentialExpiringIn(ms: number): QQCredential {
  const lifetime = 72 * HOUR;
  return {
    musicid: 1,
    musickey: 'old',
    refreshKey: 'rk',
    refreshToken: 'rt',
    loginType: 2,
    musickeyCreateTime: Math.floor((Date.now() + ms - lifetime) / 1000),
    keyExpiresIn: lifetime / 1000,
  };
}

describe('qqCredentialManager', () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.qqLoginRefresh.mockReset();
    mocks.setCookie.mockReset();
    mocks.sync.mockReset();
    qqCredentialManager.resetForTests();
  });

  it('refreshes only when the musickey is close to expiring', () => {
    expect(qqCredentialManager.needsRefresh(credentialExpiringIn(48 * HOUR))).toBe(false);
    expect(qqCredentialManager.needsRefresh(credentialExpiringIn(12 * HOUR))).toBe(true);
    expect(qqCredentialManager.needsRefresh(credentialExpiringIn(-HOUR))).toBe(true);
  });

  it('does nothing without a stored credential', async () => {
    expect(await qqCredentialManager.refreshIfNeeded()).toBe(false);
    expect(mocks.qqLoginRefresh).not.toHaveBeenCalled();
  });

  it('persists the refreshed credential and pushes the new cookie', async () => {
    await qqCredentialManager.setCredential(credentialExpiringIn(HOUR));
    const next = { ...credentialExpiringIn(72 * HOUR), musickey: 'new', openId: 'open', accessToken: 'access', expiredIn: 1_800_000_000 };
    mocks.qqLoginRefresh.mockResolvedValue({ success: true, credential: next, cookie: 'qm_keyst=new' });

    expect(await qqCredentialManager.refreshIfNeeded()).toBe(true);
    expect(mocks.qqLoginRefresh).toHaveBeenCalledWith(expect.objectContaining({ musickey: 'old' }), 'qm_keyst=old');
    expect(JSON.parse(mocks.store.get(QQ_CREDENTIAL_STORAGE_KEY)!)).toEqual(next);
    expect(await qqCredentialManager.getCredential()).toEqual(next);
    expect(mocks.setCookie).toHaveBeenCalledWith('qm_keyst=new');
    expect(mocks.sync).toHaveBeenCalledWith('qq');
  });

  it('shares one in-flight refresh and rate-limits later attempts', async () => {
    const previous = credentialExpiringIn(HOUR);
    await qqCredentialManager.setCredential(previous);
    mocks.qqLoginRefresh.mockResolvedValue({ success: false, error: 'expired' });

    const [a, b] = await Promise.all([qqCredentialManager.refresh(), qqCredentialManager.refresh()]);
    expect([a, b]).toEqual([false, false]);
    expect(await qqCredentialManager.refresh()).toBe(false);
    expect(mocks.qqLoginRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(await qqCredentialManager.getCredential()).toEqual(previous);
  });

  it('loads credentials saved before OAuth fields were retained', async () => {
    const legacy = credentialExpiringIn(HOUR);
    mocks.store.set(QQ_CREDENTIAL_STORAGE_KEY, JSON.stringify(legacy));
    expect(await qqCredentialManager.getCredential()).toEqual(legacy);
  });

  it('ignores a malformed stored credential', async () => {
    mocks.store.set(QQ_CREDENTIAL_STORAGE_KEY, '{not json');
    expect(await qqCredentialManager.getCredential()).toBeNull();
  });
});
