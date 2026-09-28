/**
 * QQ Music login credential shared by the main process (login / refresh) and
 * the renderer (persistence / scheduling).
 *
 * The web cookie (`qm_keyst` / `qqmusic_key`) only lives a few days. The login
 * response also carries `refresh_key` / `refresh_token`, which let us obtain a
 * fresh `musickey` without another QR scan. The payload shape follows the
 * community implementations (qqmusic-api-python `refresh_cookies`).
 */

/** tmeLoginType: 2 = QQ, 1 = WeChat. The QR flow in this app is QQ-Connect. */
const LOGIN_TYPE_QQ = 2;

export interface QQCredential {
  musicid: number;
  musickey: string;
  refreshKey: string;
  refreshToken: string;
  loginType: number;
  /** Epoch seconds when `musickey` was issued. */
  musickeyCreateTime: number;
  /** Lifetime of `musickey` in seconds. */
  keyExpiresIn: number;
  encryptUin?: string;
}

type Raw = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(str(v), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize a `QQConnectLogin.LoginServer.QQLogin` / `music.login.LoginServer.Login`
 * `req.data` payload. Returns null when the fields needed to refresh are absent.
 */
export function parseQQCredential(data: unknown, fallbackLoginType = LOGIN_TYPE_QQ): QQCredential | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Raw;
  const musicid = num(d['musicid'] ?? d['str_musicid']);
  const musickey = str(d['musickey']);
  const refreshKey = str(d['refresh_key']);
  const refreshToken = str(d['refresh_token']);
  if (!musicid || !musickey || (!refreshKey && !refreshToken)) return null;

  const credential: QQCredential = {
    musicid,
    musickey,
    refreshKey,
    refreshToken,
    loginType: num(d['loginType']) || fallbackLoginType,
    musickeyCreateTime: num(d['musickeyCreateTime']) || Math.floor(Date.now() / 1000),
    keyExpiresIn: num(d['keyExpiresIn']),
  };
  const encryptUin = str(d['encryptUin']);
  if (encryptUin) credential.encryptUin = encryptUin;
  return credential;
}

export function isQQCredential(v: unknown): v is QQCredential {
  if (!v || typeof v !== 'object') return false;
  const c = v as Raw;
  return typeof c['musicid'] === 'number'
    && typeof c['musickey'] === 'string'
    && typeof c['refreshKey'] === 'string'
    && typeof c['refreshToken'] === 'string'
    && typeof c['loginType'] === 'number';
}

export function buildRefreshPayload(credential: QQCredential): Record<string, unknown> {
  return {
    comm: {
      g_tk: 5381,
      platform: 'yqq',
      ct: 24,
      cv: 0,
      uin: credential.musicid,
      qq: String(credential.musicid),
      authst: credential.musickey,
      tmeLoginType: String(credential.loginType),
    },
    req: {
      module: 'music.login.LoginServer',
      method: 'Login',
      param: {
        musicid: credential.musicid,
        musickey: credential.musickey,
        refresh_key: credential.refreshKey,
        refresh_token: credential.refreshToken,
      },
    },
  };
}

/** Replace (or append) cookie entries while keeping the rest of the cookie intact. */
export function mergeCookie(cookie: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates).filter(([, v]) => v !== ''));
  const parts = cookie
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const key = pair.split('=')[0] ?? '';
      if (!pending.has(key)) return pair;
      const value = pending.get(key)!;
      pending.delete(key);
      return `${key}=${value}`;
    });
  for (const [k, v] of pending) parts.push(`${k}=${v}`);
  return parts.join('; ');
}

/** Cookie fields that carry the musickey on y.qq.com. */
export function credentialCookieFields(credential: QQCredential): Record<string, string> {
  return {
    qm_keyst: credential.musickey,
    qqmusic_key: credential.musickey,
    psrf_musickey_createtime: String(credential.musickeyCreateTime),
  };
}

/** Epoch ms when the musickey expires, or null when the lifetime is unknown. */
export function credentialExpiresAt(credential: QQCredential): number | null {
  if (!credential.keyExpiresIn || !credential.musickeyCreateTime) return null;
  return (credential.musickeyCreateTime + credential.keyExpiresIn) * 1000;
}
