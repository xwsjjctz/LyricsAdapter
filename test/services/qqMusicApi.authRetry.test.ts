import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('@/services/cookieManager', () => ({
  cookieManager: { hasCookie: () => true, getCookie: () => 'uin=1', parseCookie: () => ({ uin: '1' }) },
}));
vi.mock('@/services/qqCredentialManager', () => ({ qqCredentialManager: { refresh: mocks.refresh } }));
vi.mock('@/services/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => null }));

import { qqMusicApi } from '@/services/qqMusicApi';

const expired = { code: 500001 };
const ok = { code: 0, req_0: { data: { body: { song: { list: [] } } } } };

function stubRequests(...responses: unknown[]) {
  const requestJson = vi.fn();
  for (const r of responses) requestJson.mockResolvedValueOnce(r);
  (qqMusicApi as unknown as { requestJson: typeof requestJson }).requestJson = requestJson;
  return requestJson;
}

describe('QQ Music auth retry', () => {
  beforeEach(() => { mocks.refresh.mockReset(); });

  it('refreshes the musickey and retries once when the cookie expired', async () => {
    mocks.refresh.mockResolvedValue(true);
    const requestJson = stubRequests(expired, ok);
    await expect(qqMusicApi.searchMusic('x')).resolves.toEqual([]);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it('surfaces the original error when refresh is not possible', async () => {
    mocks.refresh.mockResolvedValue(false);
    const requestJson = stubRequests(expired);
    await expect(qqMusicApi.searchMusic('x')).rejects.toThrow('Cookie expired or invalid');
    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on unrelated failures', async () => {
    stubRequests(Promise.reject(new Error('network')));
    await expect(qqMusicApi.searchMusic('x')).rejects.toThrow(/network/);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
