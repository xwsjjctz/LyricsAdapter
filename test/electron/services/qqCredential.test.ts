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
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('refreshQQCredential', () => {
  it('posts the refresh payload and returns the rotated credential and cookie', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 0,
      req: { code: 0, data: { musicid: 12345, musickey: 'new', refresh_key: 'rk2', refresh_token: '', musickeyCreateTime: 1_700_300_000, keyExpiresIn: 259200 } },
    }));
    const result = await refreshQQCredential(credential, 'uin=o12345; qm_keyst=old', { Cookie: 'x' }, fetchImpl as unknown as typeof fetch);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg');
    expect(JSON.parse(init.body as string).req.param.refresh_key).toBe('rk1');
    expect(result.credential.musickey).toBe('new');
    expect(result.credential.refreshKey).toBe('rk2');
    // An omitted rotated token keeps the previous one.
    expect(result.credential.refreshToken).toBe('rt1');
    expect(result.cookie).toContain('qm_keyst=new');
    expect(result.cookie).toContain('qqmusic_key=new');
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
