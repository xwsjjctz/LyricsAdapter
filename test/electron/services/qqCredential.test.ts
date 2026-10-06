import { describe, expect, it, vi } from 'vitest';
import { refreshQQCredential } from '../../../electron/services/qqCredential';
import type { QQCredential } from '../../../src/shared/qqCredential';

const credential: QQCredential = {
  musicid: 12345,
  musickey: 'old',
  refreshKey: 'rk1',
  refreshToken: 'rt1',
  loginType: 2,
  musickeyCreateTime: 1_700_000_000,
  keyExpiresIn: 259200,
  openId: 'open1',
  accessToken: 'access1',
  expiredIn: 1_700_100_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('refreshQQCredential', () => {
  it('posts the refresh payload and returns the rotated credential and cookie', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 0,
      req: { code: 0, data: { musicid: 12345, musickey: 'new', refresh_key: 'rk2', refresh_token: 'rt2', openid: 'open2', access_token: 'access2', expired_in: 1_700_400_000, musickeyCreateTime: 1_700_300_000, keyExpiresIn: 259200 } },
    }));
    const result = await refreshQQCredential(credential, 'uin=o12345; qm_keyst=old', { Cookie: 'x' }, fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg');
    expect(JSON.parse(init.body as string).req.param).toEqual({
      musicid: 12345, musickey: 'old', refresh_key: 'rk1', refresh_token: 'rt1',
      openid: 'open1', access_token: 'access1', expired_in: 1_700_100_000, loginMode: 2,
    });
    expect(init.headers).toMatchObject({ Cookie: 'uin=o12345; qm_keyst=old' });
    expect(result.credential.musickey).toBe('new');
    expect(result.credential.refreshKey).toBe('rk2');
    expect(result.credential).toMatchObject({ refreshToken: 'rt2', openId: 'open2', accessToken: 'access2', expiredIn: 1_700_400_000 });
    expect(result.cookie).toContain('qm_keyst=new');
    expect(result.cookie).toContain('qqmusic_key=new');
    expect(result.cookie).toContain('psrf_qqopenid=open2');
    expect(result.cookie).toContain('psrf_qqaccess_token=access2');
    expect(result.cookie).toContain('psrf_qqrefresh_token=rt2');
    expect(result.cookie).toContain('psrf_access_token_expiresAt=1700400000');
  });

  it('retains previous OAuth and refresh tokens when a successful response omits them', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, req: { code: 0, data: { musickey: 'new', refresh_token: '', access_token: '' } } }));
    const result = await refreshQQCredential(credential, 'qm_keyst=old; p_skey=keep', {}, fetchImpl as unknown as typeof fetch);
    expect(result.credential).toMatchObject({ ...credential, musickey: 'new', musickeyCreateTime: expect.any(Number) });
    expect(result.cookie).toContain('p_skey=keep');
    expect(result.cookie).toContain('psrf_qqaccess_token=access1');
    expect(result.cookie).toContain('psrf_qqrefresh_token=rt1');
  });

  it('hydrates old saved credentials from the matching cookie before refreshing', async () => {
    const { openId: _openId, accessToken: _accessToken, expiredIn: _expiredIn, ...legacy } = credential;
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, req: { code: 0, data: { musickey: 'new' } } }));
    const result = await refreshQQCredential(legacy,
      'uin=o12345; psrf_qqopenid=recovered-open; psrf_qqaccess_token=recovered-access; psrf_access_token_expiresAt=1700200000',
      {}, fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).req.param).toMatchObject({ openid: 'recovered-open', access_token: 'recovered-access', expired_in: 1_700_200_000 });
    expect(result.credential).toMatchObject({ openId: 'recovered-open', accessToken: 'recovered-access', expiredIn: 1_700_200_000 });
  });

  it('requests a new QR login for incomplete credentials without sending a bad request', async () => {
    const fetchImpl = vi.fn();
    const { openId: _openId, ...incomplete } = credential;
    await expect(refreshQQCredential(incomplete, '', {}, fetchImpl))
      .rejects.toThrow('凭据不完整，请重新扫码登录');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([{}, { musicid: 99999, musickey: 'new' }])('rejects malformed or different-account success data: %j', async data => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, req: { code: 0, data } }));
    await expect(refreshQQCredential(credential, '', {}, fetchImpl as unknown as typeof fetch))
      .rejects.toThrow(/无效登录凭据或缺少 musickey/);
  });

  it('throws when QQ Music rejects the refresh', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 0, req: { code: 1000 } }));
    await expect(refreshQQCredential(credential, '', {}, fetchImpl as unknown as typeof fetch))
      .rejects.toThrow(/req.code=1000/);
  });

  it('throws on HTTP errors', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 502));
    await expect(refreshQQCredential(credential, '', {}, fetchImpl as unknown as typeof fetch))
      .rejects.toThrow(/HTTP 502/);
  });
});
