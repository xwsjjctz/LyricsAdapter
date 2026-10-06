/**
 * Silent QQ Music musickey refresh via `music.login.LoginServer.Login`.
 * Credential parsing / cookie helpers live in `src/shared/qqCredential.ts`.
 */
import {
  buildRefreshPayload,
  credentialCookieFields,
  mergeCookie,
  parseQQCredential,
  recoverQQCredentialFromCookie,
  type QQCredential,
} from '../../src/shared/qqCredential';

const MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

export interface RefreshResult {
  credential: QQCredential;
  cookie: string;
}

/**
 * Exchange the refresh key/token for a new musickey.
 * Throws with the upstream code when QQ Music rejects the refresh
 * Authentication rejection can mean incomplete or expired login credentials.
 */
export async function refreshQQCredential(
  credential: QQCredential,
  cookie: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<RefreshResult> {
  const current = recoverQQCredentialFromCookie(credential, cookie);
  const missingOAuth = !current.openId || (current.loginType === 2 ? !current.accessToken : !current.unionId);
  if (missingOAuth || (!current.refreshKey && !current.refreshToken)) {
    throw new Error('QQ 音乐续期凭据不完整，请重新扫码登录');
  }
  const res = await fetchImpl(MUSICU_URL, {
    method: 'POST',
    headers: {
      ...headers,
      Accept: '*/*',
      'Content-Type': 'application/json',
      Origin: 'https://y.qq.com',
      Cookie: cookie,
    },
    body: JSON.stringify(buildRefreshPayload(current)),
  });
  if (!res.ok) throw new Error(`QQ 音乐续期 HTTP ${res.status}`);

  const json = (await res.json()) as { code?: number; req?: { code?: number; data?: unknown } };
  const reqCode = json.req?.code;
  if (json.code !== 0 || reqCode !== 0) {
    const needsLogin = [1000, 104400, 104401].includes(reqCode ?? json.code ?? -1);
    throw new Error(`QQ 音乐续期被拒绝 (code=${json.code}, req.code=${reqCode})${needsLogin ? '，登录校验未通过，请重新扫码登录' : ''}`);
  }
  const next = parseQQCredential(json.req?.data, current.loginType, current);
  if (!next) throw new Error('QQ 音乐续期返回无效登录凭据或缺少 musickey');
  return { credential: next, cookie: mergeCookie(cookie, credentialCookieFields(next)) };
}
