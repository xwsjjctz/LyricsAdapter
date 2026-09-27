/**
 * Silent QQ Music musickey refresh via `music.login.LoginServer.Login`.
 * Credential parsing / cookie helpers live in `src/shared/qqCredential.ts`.
 */
import {
  buildRefreshPayload,
  credentialCookieFields,
  mergeCookie,
  parseQQCredential,
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
 * (typically the refresh token itself has expired → a new QR scan is needed).
 */
export async function refreshQQCredential(
  credential: QQCredential,
  cookie: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<RefreshResult> {
  const res = await fetchImpl(MUSICU_URL, {
    method: 'POST',
    headers: {
      ...headers,
      Accept: '*/*',
      'Content-Type': 'application/json',
      Origin: 'https://y.qq.com',
    },
    body: JSON.stringify(buildRefreshPayload(credential)),
  });
  if (!res.ok) throw new Error(`QQ 音乐续期 HTTP ${res.status}`);

  const json = (await res.json()) as { code?: number; req?: { code?: number; data?: unknown } };
  const reqCode = json.req?.code;
  if (json.code !== 0 || reqCode !== 0) {
    throw new Error(`QQ 音乐续期被拒绝 (code=${json.code}, req.code=${reqCode})`);
  }
  const next = parseQQCredential(json.req?.data, credential.loginType);
  if (!next) throw new Error('QQ 音乐续期返回缺少 musickey');

  // Some responses omit rotated refresh fields; keep the previous ones then.
  const merged: QQCredential = {
    ...next,
    refreshKey: next.refreshKey || credential.refreshKey,
    refreshToken: next.refreshToken || credential.refreshToken,
  };
  return { credential: merged, cookie: mergeCookie(cookie, credentialCookieFields(merged)) };
}
