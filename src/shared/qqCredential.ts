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
  // Optional so credentials saved before OAuth fields were retained still load.
  openId?: string;
  accessToken?: string;
  /** Upstream `expired_in` value (also returned as `expired_at`). */
  expiredIn?: number;
  unionId?: string;
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
export function parseQQCredential(
  data: unknown,
  fallbackLoginType = LOGIN_TYPE_QQ,
  previous?: QQCredential,
): QQCredential | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Raw;
  const musicid = num(d['musicid'] ?? d['str_musicid'] ?? previous?.musicid);
  const musickey = str(d['musickey']);
  const refreshKey = str(d['refresh_key']) || previous?.refreshKey || '';
  const refreshToken = str(d['refresh_token']) || previous?.refreshToken || '';
  if (!musicid || !musickey || (!refreshKey && !refreshToken)) return null;
  // Never combine one account's new musickey with another account's tokens.
  if (previous && musicid !== previous.musicid) return null;

  const credential: QQCredential = {
    musicid,
    musickey,
    refreshKey,
    refreshToken,
    loginType: num(d['loginType']) || fallbackLoginType,
    musickeyCreateTime: num(d['musickeyCreateTime']) || Math.floor(Date.now() / 1000),
    keyExpiresIn: num(d['keyExpiresIn'] ?? previous?.keyExpiresIn),
  };
  const encryptUin = str(d['encryptUin']) || previous?.encryptUin;
  if (encryptUin) credential.encryptUin = encryptUin;
  const openId = str(d['openid']) || previous?.openId;
  const accessToken = str(d['access_token']) || previous?.accessToken;
  const unionId = str(d['unionid']) || previous?.unionId;
  if (openId) credential.openId = openId;
  if (accessToken) credential.accessToken = accessToken;
  if (unionId) credential.unionId = unionId;
  const expiry = d['expired_in'] ?? d['expired_at'] ?? previous?.expiredIn;
  if (expiry !== undefined) credential.expiredIn = num(expiry);
  return credential;
}

export function isQQCredential(v: unknown): v is QQCredential {
  if (!v || typeof v !== 'object') return false;
  const c = v as Raw;
  return typeof c['musicid'] === 'number' && Number.isFinite(c['musicid']) && c['musicid'] > 0
    && typeof c['musickey'] === 'string'
    && typeof c['refreshKey'] === 'string'
    && typeof c['refreshToken'] === 'string'
    && typeof c['loginType'] === 'number'
    && typeof c['musickeyCreateTime'] === 'number' && Number.isFinite(c['musickeyCreateTime'])
    && typeof c['keyExpiresIn'] === 'number' && Number.isFinite(c['keyExpiresIn'])
    && ['encryptUin', 'openId', 'accessToken', 'unionId'].every(key => c[key] === undefined || typeof c[key] === 'string')
    && (c['expiredIn'] === undefined || (typeof c['expiredIn'] === 'number' && Number.isFinite(c['expiredIn'])));
}

/** Recover OAuth fields omitted by older app versions, using only the same account's cookie. */
export function recoverQQCredentialFromCookie(credential: QQCredential, cookie: string): QQCredential {
  const fields = new Map(cookie.split(';').map(pair => {
    const separator = pair.indexOf('=');
    return separator < 0 ? ['', ''] : [pair.slice(0, separator).trim(), pair.slice(separator + 1).trim()];
  }));
  const cookieId = fields.get('qqmusic_uin') || fields.get('uin');
  const sameAccount = cookieId
    ? num(cookieId.replace(/^o/, '')) === credential.musicid
    : fields.get('qm_keyst') === credential.musickey || fields.get('qqmusic_key') === credential.musickey;
  if (!sameAccount) return credential;

  const next = { ...credential };
  const isQQ = credential.loginType === LOGIN_TYPE_QQ;
  const openId = fields.get(isQQ ? 'psrf_qqopenid' : 'wxopenid');
  const accessToken = fields.get('psrf_qqaccess_token');
  const refreshToken = fields.get(isQQ ? 'psrf_qqrefresh_token' : 'wxrefresh_token');
  const unionId = fields.get(isQQ ? 'psrf_qqunionid' : 'wxunionid');
  if (!next.openId && openId) next.openId = openId;
  if (isQQ && !next.accessToken && accessToken) next.accessToken = accessToken;
  if (!next.refreshToken && refreshToken) next.refreshToken = refreshToken;
  if (!next.unionId && unionId) next.unionId = unionId;
  const expiry = fields.get('psrf_access_token_expiresAt');
  if (isQQ && next.expiredIn === undefined && expiry) next.expiredIn = num(expiry);
  return next;
}

export function buildRefreshPayload(credential: QQCredential): Record<string, unknown> {
  const param = credential.loginType === 1 ? {
    openid: credential.openId || '',
    unionid: credential.unionId || '',
    str_musicid: String(credential.musicid),
  } : {
    openid: credential.openId || '',
    access_token: credential.accessToken || '',
    expired_in: credential.expiredIn ?? 0,
    musicid: credential.musicid,
  };
  return {
    comm: {
      g_tk: 5381,
      platform: 'yqq',
      ct: 24,
      cv: 0,
      uin: credential.musicid,
      qq: String(credential.musicid),
      authst: credential.musickey,
      tmeLoginType: credential.loginType,
    },
    req: {
      module: 'music.login.LoginServer',
      method: 'Login',
      param: {
        ...param,
        musickey: credential.musickey,
        refresh_key: credential.refreshKey,
        refresh_token: credential.refreshToken,
        loginMode: 2,
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

/** Rotate authentication cookies together with the stored credential. */
export function credentialCookieFields(credential: QQCredential): Record<string, string> {
  const fields: Record<string, string> = {
    qm_keyst: credential.musickey,
    qqmusic_key: credential.musickey,
    psrf_musickey_createtime: String(credential.musickeyCreateTime),
  };
  if (credential.loginType === LOGIN_TYPE_QQ) {
    if (credential.openId) fields['psrf_qqopenid'] = credential.openId;
    if (credential.accessToken) fields['psrf_qqaccess_token'] = credential.accessToken;
    if (credential.refreshToken) fields['psrf_qqrefresh_token'] = credential.refreshToken;
    if (credential.unionId) fields['psrf_qqunionid'] = credential.unionId;
    if (credential.expiredIn !== undefined) fields['psrf_access_token_expiresAt'] = String(credential.expiredIn);
  } else if (credential.loginType === 1) {
    if (credential.openId) fields['wxopenid'] = credential.openId;
    if (credential.refreshToken) fields['wxrefresh_token'] = credential.refreshToken;
    if (credential.unionId) fields['wxunionid'] = credential.unionId;
  }
  return fields;
}

/** Epoch ms when the musickey expires, or null when the lifetime is unknown. */
export function credentialExpiresAt(credential: QQCredential): number | null {
  if (!credential.keyExpiresIn || !credential.musickeyCreateTime) return null;
  return (credential.musickeyCreateTime + credential.keyExpiresIn) * 1000;
}
