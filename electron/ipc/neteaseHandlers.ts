import { ipcMain } from 'electron';
import crypto from 'node:crypto';
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

/**
 * POST to a NetEase weapi endpoint.
 * @param channel  path after `/weapi`, e.g. `search/get`
 * @param params   JSON payload (will be weapi-encrypted)
 * @param cookie   optional login cookie (enables VIP/high-quality playback)
 */
async function weapiPost(
  channel: string,
  params: Record<string, unknown>,
  cookie?: string
): Promise<NetEaseRequestResult> {
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
    return { success: true, data };
  } catch (error) {
    logger.error(`[NetEase] ${channel} failed:`, error);
    return { success: false, error: (error as Error).message };
  }
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
}
