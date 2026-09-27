import { describe, expect, it } from 'vitest';
import {
  buildRefreshPayload,
  credentialCookieFields,
  credentialExpiresAt,
  isQQCredential,
  mergeCookie,
  parseQQCredential,
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
    expect(payload.req.param).toEqual({ musicid: 12345, musickey: 'Q_H_L_key1', refresh_key: 'rk1', refresh_token: 'rt1' });
    expect(payload.comm['tmeLoginType']).toBe('2');
    expect(payload.comm['authst']).toBe('Q_H_L_key1');
  });

  it('replaces musickey cookies and keeps unrelated entries', () => {
    const next = mergeCookie(
      'uin=o12345; qm_keyst=old; p_skey=ps; qqmusic_key=old',
      credentialCookieFields({ ...parseQQCredential(loginData)!, musickey: 'new' }),
    );
    expect(next).toBe('uin=o12345; qm_keyst=new; p_skey=ps; qqmusic_key=new; psrf_musickey_createtime=1700000000');
  });
});
