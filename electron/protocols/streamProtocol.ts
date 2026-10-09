import { protocol, app, ipcMain } from 'electron';
import { logger } from '../logger';
import { getMusicPlugin, getMusicPluginCookie } from '../ipc/musicPluginHandlers';

/**
 * `stream://` custom protocol — proxies third-party music CDN audio streams
 * through the main process, attaching authentication cookies.
 *
 * URL format:  stream://<source>/<songmid>?q=<quality>
 *   source   = "qq" | "netease"
 *   songmid  = third-party song id
 *   q        = quality: "128" | "320" | "flac" | "m4a"   (default "320")
 *
 * The compatibility `set-online-cookie` channel invalidates resolved URL caches.
 */

// Authentication is read from the encrypted settings repository by the plugin.

// ── CDN URL cache (re-resolve every 5 min since URLs expire) ──
interface CachedUrl {
  url: string;
  expiry: number;
}
const cdnCache = new Map<string, CachedUrl>();
const CACHE_TTL = 5 * 60_000; // 5 minutes

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
  const cookie = getMusicPluginCookie(source);
  const plugin = getMusicPlugin(source);
  if (plugin.provider.requiresCookie() && !cookie) throw new Error('请先登录音乐源');

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
      const { url } = await plugin.provider.getMusicUrl(songmid, candidate as import('../../src/services/onlineMusicProvider').OnlineQuality);
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

export function registerStreamProtocol(): void {
  // IPC: receive cookies from the renderer
  ipcMain.handle(
    'set-online-cookie',
    (_event, source: string, _cookie: string) => {
      if (/^[a-z][a-z0-9-]{0,63}$/.test(source)) {
        for (const key of cdnCache.keys()) if (key.startsWith(`${source}:`)) cdnCache.delete(key);
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
        const source = parsedUrl.hostname; // "qq" | "netease"
        const songmid = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
        const quality = parsedUrl.searchParams.get('q') || '320';

        if (!source || !songmid) {
          return new Response('Invalid stream URL', {
            status: 400,
          });
        }

        const rangeHeader = request.headers.get('range');
        const cdnUrl = await resolveCdnUrl(source, songmid, quality);

        // Build headers for the CDN fetch — User-Agent + Referer + (cookie)
        const cdnHeaders = getMusicPlugin(source).streamHeaders(getMusicPluginCookie(source));

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
        // undici reports every network failure as "fetch failed"; the reason is in `cause`.
        logger.error('[StreamProtocol] Error:', error, 'cause:', (error as { cause?: unknown }).cause ?? 'none');
        return new Response(
          (error as Error).message || 'Internal Server Error',
          { status: 502 }
        );
      }
    });

    logger.info('[StreamProtocol] ✓ stream:// protocol registered');
  });
}
