import { ipcMain } from 'electron';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { logger } from '../logger';

/**
 * NetEase Cloud Music (网易云音乐) API — main-process implementation.
 *
 * Unlike QQ Music (cookie-only), NetEase's `weapi` endpoints require an
 * AES-128-CBC + RSA envelope that the renderer cannot produce (Web Crypto
 * cannot do the raw RSA modular exponentiation NetEase uses). So the whole
 * request is built here and exposed through a single generic IPC channel.
 *
 * Algorithm ported from the well-known binaryify/netease-cloud-music-api
 * `weapi` flow: double AES-CBC with a random secret, then RSA(0x10001, N)
 * over the reversed secret. Verified against live endpoints.
 */

// Fixed weapi constants
const PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud', 'utf8');
const IV = Buffer.from('0102030405060708', 'utf8');
const RSA_PUBKEY_EXP = '010001';
const RSA_MODULUS =
  '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b7251' +
  '52b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ec' +
  'bda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d81' +
  '3cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Generate a 16-char base62 secret key (the per-request AES key). */
function randomSecretKey(length = 16): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[bytes[i]! % BASE62.length]!;
  return out;
}

/** AES-128-CBC encrypt, return base64 (matches NetEase's `aesEncrypt`). */
function aesEncrypt(plaintext: string, key: Buffer): string {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}

/**
 * NetEase RSA: reverse the secret, read its bytes as one big integer,
 * raise it to 0x10001 mod N, return a zero-padded 256-hex string.
 * (Node's crypto.publicEncrypt cannot be used — NetEase uses raw modexp,
 *  i.e. RSA/ECB/NoPadding.)
 */
function rsaEncrypt(secret: string): string {
  const reversed = Buffer.from(secret.split('').reverse().join(''), 'utf8');
  let base = 0n;
  for (const byte of reversed) base = (base << 8n) | BigInt(byte);

  let exp = BigInt('0x' + RSA_PUBKEY_EXP);
  const mod = BigInt('0x' + RSA_MODULUS);
  let result = 1n;
  let b = base % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * b) % mod;
    exp >>= 1n;
    b = (b * b) % mod;
  }
  return result.toString(16).padStart(256, '0');
}

/** Build the weapi `{ params, encSecKey }` envelope for a JSON payload. */
function weapi(data: Record<string, unknown>): { params: string; encSecKey: string } {
  const text = JSON.stringify(data);
  const secret = randomSecretKey(16);
  return {
    params: aesEncrypt(aesEncrypt(text, PRESET_KEY), Buffer.from(secret, 'utf8')),
    encSecKey: rsaEncrypt(secret),
  };
}

interface NetEaseRequestResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface NetEaseRawResult extends NetEaseRequestResult {
  /** Raw `Set-Cookie` header values (only populated where requested). */
  setCookies?: string[];
}

/**
 * POST to a NetEase weapi endpoint, optionally capturing Set-Cookie headers.
 * @param channel        path after `/weapi`, e.g. `search/get`
 * @param params         JSON payload (will be weapi-encrypted)
 * @param cookie         optional login cookie (enables VIP/high-quality playback)
 * @param captureCookies when true, populate `setCookies` from the response
 */
async function weapiRequest(
  channel: string,
  params: Record<string, unknown>,
  cookie?: string,
  captureCookies = false
): Promise<NetEaseRawResult> {
  try {
    const body = new URLSearchParams(weapi(params));
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Referer: 'https://music.163.com',
      Origin: 'https://music.163.com',
    };
    if (cookie) headers['Cookie'] = cookie;

    const res = await fetch(`https://music.163.com/weapi${channel}`, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) {
      return { success: false, error: `HTTP error: ${res.status}` };
    }
    const data = await res.json();
    logger.debug(`[NetEase] ${channel} -> code`, (data as { code?: number })?.code);
    const result: NetEaseRawResult = { success: true, data };
    if (captureCookies && typeof res.headers.getSetCookie === 'function') {
      result.setCookies = res.headers.getSetCookie();
    }
    return result;
  } catch (error) {
    logger.error(`[NetEase] ${channel} failed:`, error);
    return { success: false, error: (error as Error).message };
  }
}

/** Back-compat wrapper for the generic channel (drops Set-Cookie capture). */
function weapiPost(
  channel: string,
  params: Record<string, unknown>,
  cookie?: string
): Promise<NetEaseRequestResult> {
  // NetEaseRawResult is a structural superset of NetEaseRequestResult; the
  // extra `setCookies` field is simply ignored by generic callers.
  return weapiRequest(channel, params, cookie);
}

/** Reduce a list of `Set-Cookie` header values to a `k=v; k=v` string. */
function cookieStringFrom(setCookies: string[] | undefined): string {
  if (!setCookies?.length) return '';
  const pairs: string[] = [];
  for (const raw of setCookies) {
    if (!raw) continue;
    const first = raw.split(';')[0]?.trim();
    if (first && first.includes('=')) pairs.push(first);
  }
  return pairs.join('; ');
}

export function registerNetEaseHandlers(): void {
  // Generic weapi request: renderer chooses the channel + params.
  ipcMain.handle(
    'netease-request',
    async (_event, channel: string, params: Record<string, unknown>, cookie?: string) => {
      if (typeof channel !== 'string' || !channel) {
        return { success: false, error: 'Invalid channel' };
      }
      return weapiPost(channel, params ?? {}, cookie);
    }
  );

  // ===== QR scan login =====
  // Step 1: request a one-time `unikey` used to bind the QR + polling.
  ipcMain.handle('netease-qr-key', async () => {
    const result = await weapiPost('/login/qr/key', { type: 1, noCookie: true });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const data = result.data as { unikey?: string; data?: { unikey?: string } } | undefined;
    const unikey = data?.unikey ?? data?.data?.unikey;
    if (!unikey) {
      return { success: false, error: '未获取到 unikey' };
    }
    return { success: true, unikey };
  });

  // Step 2: render the QR for a key as a PNG data URL.
  ipcMain.handle('netease-qr-create', async (_event, key: string) => {
    if (typeof key !== 'string' || !key) {
      return { success: false, error: 'Invalid key' };
    }
    const result = await weapiPost('/login/qr/create', { key, qrimg: true, qrimg_size: 280 });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const data = result.data as { qrurl?: string; qrimg?: string } | undefined;
    const preRendered =
      typeof data?.qrimg === 'string' && data.qrimg.startsWith('data:') ? data.qrimg : '';
    const qrurl = typeof data?.qrurl === 'string' ? data.qrurl : '';
    if (!preRendered && !qrurl) {
      return { success: false, error: '未获取到二维码内容' };
    }
    try {
      const qrcode = preRendered || (await QRCode.toDataURL(qrurl, { margin: 1, width: 280 }));
      return { success: true, qrcode };
    } catch (error) {
      logger.error('[NetEase] QR render failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Step 3: poll a key. code 800=expired 801=waiting 802=confirming 803=success.
  // On 803 the login cookie arrives via Set-Cookie (MUSIC_U, __csrf, …).
  ipcMain.handle('netease-qr-check', async (_event, key: string) => {
    if (typeof key !== 'string' || !key) {
      return { success: false, error: 'Invalid key' };
    }
    const result = await weapiRequest('/login/qr/check', { key, type: 1 }, undefined, true);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const data = result.data as { code?: number; message?: string } | undefined;
    const code = Number(data?.code ?? 0);
    if (code === 803) {
      const cookie = cookieStringFrom(result.setCookies);
      logger.info('[NetEase] QR login success');
      return { success: true, code, message: data?.message ?? '登录成功', cookie };
    }
    return { success: true, code, message: data?.message };
  });
}
