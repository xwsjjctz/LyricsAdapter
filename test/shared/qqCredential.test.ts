import { describe, expect, it } from 'vitest';
import {
  buildRefreshPayload,
  credentialCookieFields,
  credentialExpiresAt,
  isQQCredential,
  mergeCookie,
  parseQQCredential,
  recoverQQCredentialFromCookie,
} from '../../src/shared/qqCredential';

const loginData = {
  musicid: 12345,
  musickey: 'Q_H_L_key1',
  refresh_key: 'rk1',
  refresh_token: 'rt1',
  loginType: 2,
  musickeyCreateTime: 1_700_000_000,
  keyExpiresIn: 259200,
  encryptUin: 'enc',
  openid: 'open1',
  access_token: 'access1',
  expired_at: 1_700_100_000,
};

describe('QQ credential helpers', () => {
  it('parses the login response data', () => {
    const credential = parseQQCredential(loginData);
    expect(credential).toEqual({
      musicid: 12345,
      musickey: 'Q_H_L_key1',
      refreshKey: 'rk1',
      refreshToken: 'rt1',
      loginType: 2,
      musickeyCreateTime: 1_700_000_000,
      keyExpiresIn: 259200,
      encryptUin: 'enc',
      openId: 'open1',
      accessToken: 'access1',
      expiredIn: 1_700_100_000,
    });
    expect(isQQCredential(credential)).toBe(true);
    expect(credentialExpiresAt(credential!)).toBe((1_700_000_000 + 259200) * 1000);
  });

  it('accepts string numbers and defaults the login type to QQ', () => {
    const credential = parseQQCredential({ str_musicid: '67890', musickey: 'k', refresh_token: 'rt' });
    expect(credential?.musicid).toBe(67890);
    expect(credential?.loginType).toBe(2);
    expect(credential?.refreshKey).toBe('');
  });

  it('returns null without refresh material', () => {
    expect(parseQQCredential({ musicid: 1, musickey: 'k' })).toBeNull();
    expect(parseQQCredential(null)).toBeNull();
    expect(isQQCredential({ musicid: '1' })).toBe(false);
  });

  it('builds the LoginServer.Login refresh payload', () => {
    const payload = buildRefreshPayload(parseQQCredential(loginData)!) as {
      comm: Record<string, unknown>;
      req: { module: string; method: string; param: Record<string, unknown> };
    };
    expect(payload.req.module).toBe('music.login.LoginServer');
    expect(payload.req.method).toBe('Login');
    expect(payload.req.param).toEqual({
      musicid: 12345, musickey: 'Q_H_L_key1', refresh_key: 'rk1', refresh_token: 'rt1',
      openid: 'open1', access_token: 'access1', expired_in: 1_700_100_000, loginMode: 2,
    });
    expect(payload.comm['tmeLoginType']).toBe(2);
    expect(payload.comm['authst']).toBe('Q_H_L_key1');
  });

  it('replaces musickey cookies and keeps unrelated entries', () => {
    const next = mergeCookie(
      'uin=o12345; qm_keyst=old; p_skey=ps; qqmusic_key=old',
      credentialCookieFields({ ...parseQQCredential(loginData)!, musickey: 'new' }),
    );
    expect(next).toContain('uin=o12345; qm_keyst=new; p_skey=ps; qqmusic_key=new');
    expect(next).toContain('psrf_musickey_createtime=1700000000');
    expect(next).toContain('psrf_qqopenid=open1');
    expect(next).toContain('psrf_qqaccess_token=access1');
    expect(next).toContain('psrf_qqrefresh_token=rt1');
    expect(next).toContain('psrf_access_token_expiresAt=1700100000');
  });

  it('preserves omitted refresh fields while requiring a new musickey from the same account', () => {
    const previous = parseQQCredential(loginData)!;
    expect(parseQQCredential({ musickey: 'new', refresh_token: '' }, 2, previous)).toMatchObject({
      ...previous, musickey: 'new', musickeyCreateTime: expect.any(Number),
    });
    expect(parseQQCredential({}, 2, previous)).toBeNull();
    expect(parseQQCredential({ musicid: 99999, musickey: 'new' }, 2, previous)).toBeNull();
  });

  it('recovers legacy fields only from matching cookies and preserves equals signs in tokens', () => {
    const legacy = parseQQCredential({ musicid: 12345, musickey: 'old', refresh_key: 'rk' })!;
    const cookie = 'uin=o00012345; psrf_qqopenid=open1; psrf_qqaccess_token=access==; psrf_qqrefresh_token=rt; psrf_access_token_expiresAt=1700100000';
    expect(recoverQQCredentialFromCookie(legacy, cookie)).toMatchObject({
      openId: 'open1', accessToken: 'access==', refreshToken: 'rt', expiredIn: 1_700_100_000,
    });
    expect(recoverQQCredentialFromCookie(legacy, cookie.replace('o00012345', 'o99999'))).toEqual(legacy);
    expect(recoverQQCredentialFromCookie(legacy, cookie.replace('uin=o00012345', 'qm_keyst=old'))).toHaveProperty('openId', 'open1');
    expect(recoverQQCredentialFromCookie(legacy, cookie.replace('uin=o00012345', 'qm_keyst=unrelated'))).toEqual(legacy);
    expect(recoverQQCredentialFromCookie(parseQQCredential(loginData)!, cookie)).toHaveProperty('accessToken', 'access1');
  });

  it('accepts legacy storage but rejects malformed optional OAuth fields', () => {
    const legacy = parseQQCredential({ musicid: 12345, musickey: 'old', refresh_key: 'rk' })!;
    expect(isQQCredential(legacy)).toBe(true);
    expect(isQQCredential({ ...legacy, accessToken: {} })).toBe(false);
    expect(isQQCredential({ ...legacy, expiredIn: '10' })).toBe(false);
    expect(isQQCredential({ ...legacy, keyExpiresIn: undefined })).toBe(false);
  });

  it('uses zero for unknown OAuth expiry and the WeChat fields for login type 1', () => {
    const credential = parseQQCredential({ musicid: 1, musickey: 'k', refresh_token: 'rt', openid: 'open' })!;
    const qq = buildRefreshPayload(credential) as { req: { param: Record<string, unknown> } };
    expect(qq.req.param['expired_in']).toBe(0);
    const wechat = { ...credential, loginType: 1, unionId: 'union' };
    const payload = buildRefreshPayload(wechat) as { comm: Record<string, unknown>; req: { param: Record<string, unknown> } };
    expect(payload.comm['tmeLoginType']).toBe(1);
    expect(payload.req.param).toEqual({ openid: 'open', unionid: 'union', str_musicid: '1', musickey: 'k', refresh_key: '', refresh_token: 'rt', loginMode: 2 });
    expect(credentialCookieFields(wechat)).toMatchObject({ wxopenid: 'open', wxunionid: 'union', wxrefresh_token: 'rt' });
    expect(credentialCookieFields(wechat)).not.toHaveProperty('psrf_qqopenid');
  });
});
