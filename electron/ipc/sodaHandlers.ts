/**
 * Soda Music renderer bridge and encrypted-audio resolver.
 *
 * Endpoint shapes and the encrypted-MP4 decoder are derived from
 * guohuiyuan/music-lib (AGPL-3.0-or-later). See THIRD_PARTY_NOTICES.md.
 */
import { ipcMain } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import { expandHomeDir } from '../utils/fileUtils';
import { allowAudioPath } from './typedHandlers';
import { decryptSodaAudio } from '../utils/sodaAudioDecrypt';

const API_BASE_URL = 'https://api.qishui.com/luna/pc';
const WEB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const PC_USER_AGENT = 'LunaPC/3.3.0(359450208)';
let sodaDownloadTail: Promise<void> = Promise.resolve();

export type SodaRequestRoute =
  | 'search-track'
  | 'track'
  | 'me'
  | 'user-playlists'
  | 'playlist-detail';

interface SodaRequestResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface SodaStreamFile {
  filePath: string;
  size: number;
  contentType: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  throw error;
}

/** Soda decryption needs a complete file, so only one full payload may be
 * resident at a time. Cancelled queued jobs are rejected before they allocate. */
async function withSodaDownloadSlot<T>(
  signal: AbortSignal | undefined,
  task: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const previous = sodaDownloadTail;
  sodaDownloadTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    throwIfAborted(signal);
    return await task();
  } finally {
    release();
  }
}

function buildPcParams(): URLSearchParams {
  const timestamp = Date.now();
  const deviceId = String(timestamp);
  const params = new URLSearchParams({
    aid: '386088',
    app_name: 'luna_pc',
    region: 'cn',
    geo_region: 'cn',
    os_region: 'cn',
    device_id: deviceId,
    iid: String(timestamp + 1),
    version_name: '3.3.0',
    version_code: '30030000',
    channel: 'official',
    build_mode: 'master',
    ac: 'wifi',
    tz_name: 'Asia/Shanghai',
    device_platform: 'windows',
    device_type: 'Windows',
    os_version: 'Windows 11',
    fp: deviceId,
  });
  return params;
}

function buildSodaUrl(route: SodaRequestRoute, input: Record<string, unknown>): { url: string; pc: boolean } {
  const value = (name: string): string => stringValue(input[name]);
  if (route === 'search-track') {
    const query = value('q');
    if (!query) throw new Error('Search query is required');
    const params = new URLSearchParams({
      q: query,
      cursor: value('cursor') || '0',
      search_method: 'input',
      aid: '386088',
      device_platform: 'web',
      channel: 'pc_web',
    });
    return { url: `${API_BASE_URL}/search/track?${params.toString()}`, pc: false };
  }
  if (route === 'track') {
    const trackId = value('trackId');
    if (!trackId) throw new Error('Track id is required');
    const params = new URLSearchParams({
      track_id: trackId,
      media_type: 'track',
      aid: '386088',
      device_platform: 'web',
      channel: 'pc_web',
    });
    return { url: `${API_BASE_URL}/track_v2?${params.toString()}`, pc: false };
  }

  const params = buildPcParams();
  if (route === 'me') return { url: `${API_BASE_URL}/me?${params.toString()}`, pc: true };
  if (route === 'user-playlists') {
    const userId = value('userId');
    if (!userId) throw new Error('User id is required');
    params.set('user_id', userId);
    params.set('cursor', value('cursor'));
    params.set('count', value('count') || '100');
    return { url: `${API_BASE_URL}/user/playlist?${params.toString()}`, pc: true };
  }
  const playlistId = value('playlistId');
  if (!playlistId) throw new Error('Playlist id is required');
  params.set('playlist_id', playlistId);
  params.set('cursor', value('cursor'));
  params.set('count', value('count') || '100');
  return { url: `${API_BASE_URL}/playlist/detail?${params.toString()}`, pc: true };
}

function assertSodaSuccess(data: unknown): void {
  const record = asRecord(data);
  const statusCode = record?.['status_code'];
  if (typeof statusCode === 'number' && statusCode !== 0) {
    const statusInfo = asRecord(record?.['status_info']);
    throw new Error(stringValue(statusInfo?.['status_msg']) || `Soda API error: ${statusCode}`);
  }
}

export async function sodaRequest(
  route: SodaRequestRoute,
  params: Record<string, unknown>,
  cookie?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const request = buildSodaUrl(route, params);
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': request.pc ? PC_USER_AGENT : WEB_USER_AGENT,
  };
  if (request.pc) {
    headers['x-luna-background-type'] = 'foreground';
    headers['x-luna-is-background-req'] = '0';
    headers['x-luna-is-local-user'] = '1';
  }
  if (cookie) headers['Cookie'] = cookie;

  const response = await fetch(request.url, {
    headers,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Soda API HTTP ${response.status}`);
  const data: unknown = await response.json();
  assertSodaSuccess(data);
  return data;
}

function selectPlayerInfo(data: unknown): { url: string; playAuth: string; format: string } {
  const root = asRecord(data);
  const trackPlayer = asRecord(root?.['track_player']);
  const playerInfoUrl = stringValue(trackPlayer?.['url_player_info']);
  if (!playerInfoUrl) throw new Error('Soda did not return a playback resolver');
  return { url: playerInfoUrl, playAuth: '', format: '' };
}

async function resolveSodaAudio(
  trackId: string,
  cookie: string,
  signal?: AbortSignal,
): Promise<{ url: string; playAuth: string; format: string }> {
  if (!cookie.trim()) throw new Error('请先在设置中填写汽水音乐 Cookie');
  const track = await sodaRequest('track', { trackId }, cookie, signal);
  const player = selectPlayerInfo(track);
  const response = await fetch(player.url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': WEB_USER_AGENT,
      Cookie: cookie,
    },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Soda player API HTTP ${response.status}`);
  const data: unknown = await response.json();
  const root = asRecord(data);
  const result = asRecord(root?.['Result']);
  const dataRecord = asRecord(result?.['Data']);
  const list = dataRecord?.['PlayInfoList'];
  if (!Array.isArray(list)) throw new Error('Soda did not return a playable audio stream');

  let best: { url: string; playAuth: string; format: string; bitrate: number } | null = null;
  for (const item of list) {
    const info = asRecord(item);
    const url = stringValue(info?.['MainPlayURL']) || stringValue(info?.['BackupPlayURL']);
    if (!url) continue;
    const bitrate = typeof info?.['Bitrate'] === 'number' ? info['Bitrate'] : 0;
    if (!best || bitrate > best.bitrate) {
      best = {
        url,
        playAuth: stringValue(info?.['PlayAuth']),
        format: stringValue(info?.['Format']),
        bitrate,
      };
    }
  }
  if (!best?.playAuth) throw new Error('Soda audio stream has no decryption authorization');
  return best;
}

function sodaContentType(format: string): string {
  switch (format.toLowerCase()) {
    case 'flac': return 'audio/flac';
    case 'mp3': return 'audio/mpeg';
    case 'aac': return 'audio/aac';
    case 'm4a':
    case 'mp4':
    default: return 'audio/mp4';
  }
}

/**
 * Resolve, download and decrypt a Soda stream directly into a file.
 *
 * Soda's encrypted MP4 container requires the complete payload for sample-table
 * decryption, but the decrypted bytes do not need to remain resident after the
 * file write. Playback serves this file with Range requests.
 */
export async function fetchSodaStreamToFile(
  trackId: string,
  cookie: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<SodaStreamFile> {
  return withSodaDownloadSlot(signal, async () => {
    const partPath = `${filePath}.${crypto.randomUUID()}.part`;
    let committed = false;
    try {
      throwIfAborted(signal);
      const stream = await resolveSodaAudio(trackId, cookie, signal);
      const response = await fetch(stream.url, {
        headers: { 'User-Agent': WEB_USER_AGENT },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new Error(`Soda CDN HTTP ${response.status}`);

      // Buffer.from(ArrayBuffer) shares its backing allocation. Decryption is
      // performed in-place, so this is the only complete audio payload in RAM.
      const encrypted = Buffer.from(await response.arrayBuffer());
      throwIfAborted(signal);
      const data = decryptSodaAudio(encrypted, stream.playAuth);
      throwIfAborted(signal);

      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(partPath, data, { signal });
      throwIfAborted(signal);
      try {
        await fs.promises.rename(partPath, filePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'EPERM') throw error;
        await fs.promises.unlink(filePath).catch((unlinkError: NodeJS.ErrnoException) => {
          if (unlinkError.code !== 'ENOENT') throw unlinkError;
        });
        await fs.promises.rename(partPath, filePath);
      }
      committed = true;
      throwIfAborted(signal);
      return {
        filePath,
        size: data.length,
        contentType: sodaContentType(stream.format),
      };
    } catch (error) {
      await fs.promises.unlink(partPath).catch(() => {});
      if (committed) await fs.promises.unlink(filePath).catch(() => {});
      throw error;
    }
  });
}

export function registerSodaHandlers(): void {
  ipcMain.handle(
    'soda-request',
    async (_event, route: SodaRequestRoute, params: Record<string, unknown>, cookie?: string): Promise<SodaRequestResult> => {
      try {
        const validRoutes: SodaRequestRoute[] = ['search-track', 'track', 'me', 'user-playlists', 'playlist-detail'];
        if (!validRoutes.includes(route)) return { success: false, error: 'Invalid Soda API route' };
        return { success: true, data: await sodaRequest(route, params ?? {}, cookie) };
      } catch (error) {
        logger.warn('[Soda] API request failed:', error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  ipcMain.handle('download-soda-audio', async (_event, trackId: string, cookie: string, filePath: string) => {
    try {
      if (typeof trackId !== 'string' || !trackId || typeof filePath !== 'string' || !filePath) {
        return { success: false, error: 'Invalid Soda download request' };
      }
      const target = expandHomeDir(filePath);
      const audio = await fetchSodaStreamToFile(trackId, cookie, target);
      allowAudioPath(target);
      logger.info('[Soda] Download completed:', path.basename(target), audio.size, 'bytes');
      return { success: true, filePath: target, size: audio.size };
    } catch (error) {
      logger.error('[Soda] Download failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
