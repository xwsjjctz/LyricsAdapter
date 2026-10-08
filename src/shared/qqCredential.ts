/** Compatibility shape for persisted QQ credentials. Network protocols belong to the music plugin. */
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

/** Epoch ms when the musickey expires, or null when the lifetime is unknown. */
export function credentialExpiresAt(credential: QQCredential): number | null {
  if (!credential.keyExpiresIn || !credential.musickeyCreateTime) return null;
  return (credential.musickeyCreateTime + credential.keyExpiresIn) * 1000;
}
