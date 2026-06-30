import { logger } from './logger';

/**
 * Renderer-side wrappers around the main-process QR-scan-login bridge.
 *
 * Both sources follow the same shape: a `start` returns a PNG data URL + a
 * session key (QQ token / NetEase unikey), and a `poll` returns a normalized
 * status until the login completes or the QR expires. Browser builds have no
 * bridge and throw — QR login is desktop-only.
 */

export type QRLoginStatus = 'waiting' | 'confirming' | 'done' | 'expired' | 'error';

export interface QRStartResult {
  qrcode: string; // PNG data URL
  sessionKey: string; // QQ session token or NetEase unikey
  expiresIn: number; // seconds before the QR hard-expires
}

export interface QRPollResult {
  status: QRLoginStatus;
  // Allow explicit `undefined` so wrappers can forward optional fields verbatim
  // (the project enables exactOptionalPropertyTypes).
  msg?: string | undefined;
  cookie?: string | undefined; // present only on success
}

function ensureBridge(method: string): void {
  const api = window.electron as unknown as Record<string, unknown> | undefined;
  if (!api) {
    throw new Error('扫码登录仅在桌面端可用');
  }
  if (typeof api[method] !== 'function') {
    throw new Error(`桌面端版本过低，缺少 ${method}`);
  }
}

// ===== QQ Music =====
export async function startQQLogin(): Promise<QRStartResult> {
  ensureBridge('qqLoginQrStart');
  const r = await window.electron!.qqLoginQrStart!();
  if (!r.success || !r.token || !r.qrcode) {
    throw new Error(r.error || '获取 QQ 二维码失败');
  }
  return { qrcode: r.qrcode, sessionKey: r.token, expiresIn: r.expiresIn ?? 120 };
}

export async function pollQQLogin(token: string): Promise<QRPollResult> {
  const r = await window.electron!.qqLoginQrPoll!(token);
  if (!r.success || !r.status) {
    return { status: 'error', msg: r.error };
  }
  // A poll against a session that no longer exists is terminal.
  if (r.status === 'error' && /invalid|token/i.test(r.msg ?? '')) {
    return { status: 'expired', msg: '二维码已失效' };
  }
  return { status: r.status, msg: r.msg, cookie: r.cookie };
}

// ===== NetEase Cloud Music =====
export async function startNetEaseQR(): Promise<QRStartResult> {
  ensureBridge('neteaseQrKey');
  const keyRes = await window.electron!.neteaseQrKey!();
  if (!keyRes.success || !keyRes.unikey) {
    throw new Error(keyRes.error || '获取网易云二维码失败');
  }
  const qrRes = await window.electron!.neteaseQrCreate!(keyRes.unikey);
  if (!qrRes.success || !qrRes.qrcode) {
    throw new Error(qrRes.error || '渲染网易云二维码失败');
  }
  return { qrcode: qrRes.qrcode, sessionKey: keyRes.unikey, expiresIn: 180 };
}

export async function pollNetEaseQR(key: string): Promise<QRPollResult> {
  const r = await window.electron!.neteaseQrCheck!(key);
  if (!r.success) {
    return { status: 'error', msg: r.error };
  }
  switch (r.code) {
    case 800:
      return { status: 'expired', msg: r.message || '二维码已过期' };
    case 801:
      return { status: 'waiting', msg: '请使用网易云音乐 APP 扫码' };
    case 802:
      return { status: 'confirming', msg: '请在手机上确认登录' };
    case 803:
      return { status: 'done', msg: '登录成功', cookie: r.cookie };
    default:
      return { status: 'error', msg: r.message };
  }
}

/** Log a poll result for diagnostics without spamming on healthy waiting ticks. */
export function logPollResult(scope: string, res: QRPollResult): void {
  if (res.status === 'waiting') return;
  logger.debug(`[QRLogin:${scope}] ${res.status}`, res.msg ?? '');
}
