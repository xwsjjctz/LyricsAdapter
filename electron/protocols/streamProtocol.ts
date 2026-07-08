import { protocol, app, ipcMain } from 'electron';
import { logger } from '../logger';
import { qqResolveStreamUrl } from '../ipc/metadataHandlers';
import { resolveNetEaseStreamUrl } from '../ipc/neteaseHandlers';

/**
 * `stream://` custom protocol — proxies third-party music CDN audio streams
 * through the main process, attaching authentication cookies.
 *
 * URL format:  stream://<source>/<songmid>?q=<quality>
 *   source   = "qq" | "netease"
 *   songmid  = third-party song id (QQ songmid / NetEase numeric id)
 *   q        = quality: "128" | "320" | "flac" | "m4a"   (default "320")
 *
 * Cookies are pushed from the renderer via the `set-online-cookie` IPC channel.
 */

// ── Cookie store (synced from renderer on login / app start) ──
const onlineCookies: { qq?: string; netease?: string; [source: string]: string | undefined } = {};

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

export function registerStreamProtocol(): void {
  // IPC: receive cookies from the renderer
  ipcMain.handle(
    'set-online-cookie',
    (_event, source: string, cookie: string) => {
      if (source === 'qq' || source === 'netease') {
        onlineCookies[source] = cookie;
        logger.info(`[StreamProtocol] Cookie updated for ${source}`);
      }
    }
  );

  app.whenReady().then(() => {
    protocol.handle('stream', async (request) => {
      try {
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

        const cdnUrl = await resolveCdnUrl(source, songmid, quality);
        const rangeHeader = request.headers.get('range');

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
