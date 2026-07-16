import { protocol, app, ipcMain } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import rangeParser from 'range-parser';
import { logger } from '../logger';
import { qqResolveStreamUrl } from '../ipc/metadataHandlers';
import { resolveNetEaseStreamUrl } from '../ipc/neteaseHandlers';
import { fetchSodaStreamToFile } from '../ipc/sodaHandlers';
import { nodeReadableToWeb } from '../utils/nodeReadableToWeb';

/**
 * `stream://` custom protocol — proxies third-party music CDN audio streams
 * through the main process, attaching authentication cookies.
 *
 * URL format:  stream://<source>/<songmid>?q=<quality>
 *   source   = "qq" | "netease" | "soda"
 *   songmid  = third-party song id
 *   q        = quality: "128" | "320" | "flac" | "m4a"   (default "320")
 *
 * Cookies are pushed from the renderer via the `set-online-cookie` IPC channel.
 */

// ── Cookie store (synced from renderer on login / app start) ──
const onlineCookies: { qq?: string; netease?: string; soda?: string; [source: string]: string | undefined } = {};

// ── CDN URL cache (re-resolve every 5 min since URLs expire) ──
interface CachedUrl {
  url: string;
  expiry: number;
}
const cdnCache = new Map<string, CachedUrl>();
const CACHE_TTL = 5 * 60_000; // 5 minutes

interface CachedSodaAudio {
  filePath: string;
  size: number;
  contentType: string;
  activeReaders: number;
  pendingDelete: boolean;
  unlinkScheduled: boolean;
}
const sodaAudioCache = new Map<string, CachedSodaAudio>();
interface SodaAudioInFlight {
  promise: Promise<CachedSodaAudio>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}
const sodaAudioInFlight = new Map<string, SodaAudioInFlight>();
const SODA_CACHE_LIMIT = 3;
let sodaCacheInitPromise: Promise<void> | null = null;
const sodaCacheSessionId = `${process.pid}-${crypto.randomUUID()}`;

function getSodaCacheRoot(): string {
  return path.join(app.getPath('temp'), 'LyricsAdapter', 'soda-audio');
}

function getSodaCacheDir(): string {
  return path.join(getSodaCacheRoot(), sodaCacheSessionId);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function ensureSodaCacheDir(): Promise<string> {
  const cacheDir = getSodaCacheDir();
  if (!sodaCacheInitPromise) {
    sodaCacheInitPromise = (async () => {
      const cacheRoot = getSodaCacheRoot();
      await fs.promises.mkdir(cacheRoot, { recursive: true });
      const sessions = await fs.promises.readdir(cacheRoot, { withFileTypes: true });
      await Promise.all(sessions.map(async session => {
        if (!session.isDirectory() || session.name === sodaCacheSessionId) return;
        const pid = Number.parseInt(session.name.split('-', 1)[0] ?? '', 10);
        if (Number.isFinite(pid) && isProcessRunning(pid)) return;
        await fs.promises.rm(path.join(cacheRoot, session.name), {
          recursive: true,
          force: true,
        }).catch(() => {});
      }));
      await fs.promises.mkdir(cacheDir, { recursive: true });
      // Each process owns a unique directory so a second app instance can
      // never delete files that the first instance is currently streaming.
      app.once('will-quit', () => {
        void fs.promises.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
      });
    })();
  }
  await sodaCacheInitPromise;
  return cacheDir;
}

function scheduleSodaFileDelete(entry: CachedSodaAudio, attempt = 0): void {
  if (entry.activeReaders > 0 || entry.unlinkScheduled) return;
  entry.unlinkScheduled = true;
  const timer = setTimeout(() => {
    entry.unlinkScheduled = false;
    if (entry.activeReaders > 0) return;
    void fs.promises.unlink(entry.filePath).catch((error: NodeJS.ErrnoException) => {
      if ((error.code === 'EBUSY' || error.code === 'EPERM') && attempt < 5) {
        scheduleSodaFileDelete(entry, attempt + 1);
      } else if (error.code !== 'ENOENT') {
        logger.warn('[StreamProtocol] Failed to remove Soda cache file:', error);
      }
    });
  }, Math.min(100 * (attempt + 1), 1000));
  timer.unref();
}

function deleteSodaCacheEntry(key: string, entry: CachedSodaAudio): void {
  if (sodaAudioCache.get(key) === entry) sodaAudioCache.delete(key);
  entry.pendingDelete = true;
  scheduleSodaFileDelete(entry);
}

function retainSodaCacheEntry(entry: CachedSodaAudio): void {
  entry.activeReaders += 1;
}

function releaseSodaCacheEntry(entry: CachedSodaAudio): void {
  entry.activeReaders = Math.max(0, entry.activeReaders - 1);
  if (entry.pendingDelete) scheduleSodaFileDelete(entry);
}

/** Periodic cache GC — every 5 minutes. */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cdnCache) {
    if (now > v.expiry) cdnCache.delete(k);
  }
}, CACHE_TTL).unref();

/**
 * Resolve (or resolve + cache) a playable CDN URL for a given source/songmid.
 */
const QUALITY_FALLBACKS: Record<string, string[]> = {
  flac: ['flac', '320', '128', 'm4a'],
  '320': ['320', '128', 'm4a'],
  '128': ['128', 'm4a'],
  m4a: ['m4a', '128'],
};

async function resolveCdnUrl(
  source: string,
  songmid: string,
  quality: string
): Promise<string> {
  const cookie = onlineCookies[source];
  if (source === 'qq' && !cookie) throw new Error('请先登录 QQ 音乐');
  if (source !== 'qq' && source !== 'netease') {
    throw new Error(`Unknown source: ${source}`);
  }

  const qualities = QUALITY_FALLBACKS[quality] ?? [quality, '128'];
  let lastError: unknown;
  for (const candidate of qualities) {
    const cacheKey = `${source}:${songmid}:${candidate}`;
    const cached = cdnCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      logger.debug(`[StreamProtocol] CDN cache hit: ${cacheKey}`);
      return cached.url;
    }

    try {
      const url = source === 'qq'
        ? await qqResolveStreamUrl(songmid, candidate, cookie!)
        : await resolveNetEaseStreamUrl(songmid, candidate, cookie);
      cdnCache.set(cacheKey, { url, expiry: Date.now() + CACHE_TTL });
      if (candidate !== quality) {
        logger.info(`[StreamProtocol] ${source}:${songmid} fell back ${quality} -> ${candidate}`);
      }
      return url;
    } catch (error) {
      lastError = error;
      logger.warn(`[StreamProtocol] Resolve failed for ${source}:${songmid}@${candidate}:`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to resolve stream URL');
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function consumeSodaRequest(
  request: SodaAudioInFlight,
  signal: AbortSignal,
): Promise<CachedSodaAudio> {
  request.consumers += 1;
  return new Promise<CachedSodaAudio>((resolve, reject) => {
    let finished = false;
    const finish = (callback: () => void) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', onAbort);
      request.consumers = Math.max(0, request.consumers - 1);
      if (request.consumers === 0 && !request.settled) request.controller.abort();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    request.promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}

async function getSodaAudio(
  songmid: string,
  cookie: string | undefined,
  signal: AbortSignal,
): Promise<CachedSodaAudio> {
  if (!cookie) throw new Error('请先在设置中填写汽水音乐 Cookie');
  if (signal.aborted) throw abortError();
  const cached = sodaAudioCache.get(songmid);
  if (cached) {
    sodaAudioCache.delete(songmid);
    sodaAudioCache.set(songmid, cached);
    return cached;
  }

  let existingRequest = sodaAudioInFlight.get(songmid);
  if (existingRequest?.controller.signal.aborted) {
    if (sodaAudioInFlight.get(songmid) === existingRequest) sodaAudioInFlight.delete(songmid);
    existingRequest = undefined;
  }
  if (existingRequest) return consumeSodaRequest(existingRequest, signal);

  const controller = new AbortController();
  const inFlight: SodaAudioInFlight = {
    controller,
    consumers: 0,
    settled: false,
    promise: Promise.resolve(null as unknown as CachedSodaAudio),
  };
  inFlight.promise = (async () => {
    const cacheDir = await ensureSodaCacheDir();
    const cacheName = crypto.createHash('sha256').update(songmid).digest('hex').slice(0, 32);
    // Every generation gets a unique path. An asynchronous cleanup belonging
    // to an expired generation must never be able to unlink its replacement.
    const generation = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const filePath = path.join(cacheDir, `${cacheName}-${generation}.audio`);

    try {
      const audio = await fetchSodaStreamToFile(songmid, cookie, filePath, controller.signal);
      if (controller.signal.aborted) {
        await fs.promises.unlink(audio.filePath).catch(() => {});
        throw abortError();
      }
      const entry: CachedSodaAudio = {
        filePath: audio.filePath,
        size: audio.size,
        contentType: audio.contentType,
        activeReaders: 0,
        pendingDelete: false,
        unlinkScheduled: false,
      };
      const previous = sodaAudioCache.get(songmid);
      if (previous) deleteSodaCacheEntry(songmid, previous);
      sodaAudioCache.set(songmid, entry);
      while (sodaAudioCache.size > SODA_CACHE_LIMIT) {
        const oldestKey = sodaAudioCache.keys().next().value;
        if (oldestKey === undefined) break;
        const oldest = sodaAudioCache.get(oldestKey);
        if (!oldest) break;
        deleteSodaCacheEntry(oldestKey, oldest);
      }
      return entry;
    } catch (error) {
      void fs.promises.unlink(filePath).catch(() => {});
      throw error;
    }
  })();

  sodaAudioInFlight.set(songmid, inFlight);
  void inFlight.promise.then(
    () => { inFlight.settled = true; },
    () => { inFlight.settled = true; },
  ).finally(() => {
    if (sodaAudioInFlight.get(songmid) === inFlight) sodaAudioInFlight.delete(songmid);
  });
  return consumeSodaRequest(inFlight, signal);
}

async function createSodaResponse(
  songmid: string,
  cookie: string | undefined,
  rangeHeader: string | null,
  signal: AbortSignal,
  method: string,
): Promise<Response> {
  const audio = await getSodaAudio(songmid, cookie, signal);
  retainSodaCacheEntry(audio);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseSodaCacheEntry(audio);
  };
  const headers: Record<string, string> = {
    'Content-Type': audio.contentType,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
  };

  if (rangeHeader) {
    const parsed = rangeParser(audio.size, rangeHeader);
    if (typeof parsed === 'number' || parsed.length !== 1) {
      release();
      return new Response('Requested Range Not Satisfiable', {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${audio.size}` },
      });
    }
    const range = parsed[0]!;
    const contentLength = range.end - range.start + 1;
    if (method === 'HEAD') {
      release();
      return new Response(null, {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${range.start}-${range.end}/${audio.size}`,
          'Content-Length': String(contentLength),
        },
      });
    }
    const source = fs.createReadStream(audio.filePath, {
          start: range.start,
          end: range.end,
          highWaterMark: 256 * 1024,
        });
    source.once('close', release);
    const body = nodeReadableToWeb(source, signal);
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${audio.size}`,
        'Content-Length': String(contentLength),
      },
    });
  }

  if (method === 'HEAD') {
    release();
    return new Response(null, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(audio.size) },
    });
  }
  const source = fs.createReadStream(audio.filePath, {
        highWaterMark: 256 * 1024,
      });
  source.once('close', release);
  const body = nodeReadableToWeb(source, signal);
  return new Response(body, {
    status: 200,
    headers: { ...headers, 'Content-Length': String(audio.size) },
  });
}

export function registerStreamProtocol(): void {
  // IPC: receive cookies from the renderer
  ipcMain.handle(
    'set-online-cookie',
    (_event, source: string, cookie: string) => {
      if (source === 'qq' || source === 'netease' || source === 'soda') {
        onlineCookies[source] = cookie;
        logger.info(`[StreamProtocol] Cookie updated for ${source}`);
      }
    }
  );

  app.whenReady().then(() => {
    protocol.handle('stream', async (request) => {
      try {
        if (request.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
              'Access-Control-Allow-Headers': 'Range, Content-Type',
            },
          });
        }
        const parsedUrl = new URL(request.url);
        // stream://<source>/<songmid>?q=<quality>
        const source = parsedUrl.hostname; // "qq" | "netease" | "soda"
        const songmid = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
        const quality = parsedUrl.searchParams.get('q') || '320';

        if (!source || !songmid) {
          return new Response('Invalid stream URL', {
            status: 400,
          });
        }

        const rangeHeader = request.headers.get('range');
        if (source === 'soda') {
          return await createSodaResponse(
            songmid,
            onlineCookies.soda,
            rangeHeader,
            request.signal,
            request.method,
          );
        }
        const cdnUrl = await resolveCdnUrl(source, songmid, quality);

        // Build headers for the CDN fetch — User-Agent + Referer + (cookie)
        const cdnHeaders: Record<string, string> = {
          Accept: '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer:
            source === 'qq'
              ? 'https://y.qq.com/'
              : 'https://music.163.com',
          Origin:
            source === 'qq'
              ? 'https://y.qq.com'
              : 'https://music.163.com',
        };
        const cookie = onlineCookies[source];
        if (cookie) cdnHeaders['Cookie'] = cookie;

        const cdnRes = await fetch(cdnUrl, {
          headers: rangeHeader
            ? { ...cdnHeaders, Range: rangeHeader }
            : cdnHeaders,
          signal: request.signal,
        });

        if (!cdnRes.ok && cdnRes.status !== 206) {
          return new Response(`CDN error: ${cdnRes.status}`, {
            status: cdnRes.status,
          });
        }

        // Build the response — forward content-type, length, range from the CDN
        const contentType =
          cdnRes.headers.get('content-type') || 'audio/mpeg';
        const contentLength = cdnRes.headers.get('content-length');
        const contentRange = cdnRes.headers.get('content-range');

        const responseHeaders: Record<string, string> = {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
        };
        if (contentLength) responseHeaders['Content-Length'] = contentLength;
        if (contentRange) responseHeaders['Content-Range'] = contentRange;

        return new Response(cdnRes.body, {
          status: cdnRes.status === 206 ? 206 : 200,
          headers: responseHeaders,
        });
      } catch (error) {
        if (request.signal.aborted || (error as Error).name === 'AbortError') {
          return new Response(null, { status: 499 });
        }
        logger.error('[StreamProtocol] Error:', error);
        return new Response(
          (error as Error).message || 'Internal Server Error',
          { status: 502 }
        );
      }
    });

    logger.info('[StreamProtocol] ✓ stream:// protocol registered');
  });
}
