import { ipcMain } from "electron";
import { logger } from "../logger";
export function registerQQMusicHandlers(): void {
  ipcMain.handle('qq-music-request', async (_event, options: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    cookie?: string;
  }) => {
    try {
      if (!options?.url) {
        throw new Error('Missing QQ Music request URL');
      }

      const requestUrl = new URL(options.url);
      const allowedHosts = new Set(['u.y.qq.com', 'c.y.qq.com', 'y.qq.com']);
      if (!allowedHosts.has(requestUrl.hostname)) {
        throw new Error(`Unsupported QQ Music host: ${requestUrl.hostname}`);
      }

      logger.info('[Main] QQ Music request:', options.method || 'GET', requestUrl.hostname, requestUrl.pathname);

      const requestInit: RequestInit = {
        method: options.method || 'GET',
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Referer': 'https://y.qq.com/',
          ...(options.headers || {}),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
        },
      };
      if (options.body !== undefined) {
        requestInit.body = options.body;
      }

      const response = await fetch(requestUrl.toString(), requestInit);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const text = await response.text();
      const jsonText = text.trim().replace(/^[\w$]+\((.*)\);?$/s, '$1');
      const data = jsonText ? JSON.parse(jsonText) : null;
      return { success: true, data };
    } catch (error) {
      logger.error('[Main] QQ Music request failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  ipcMain.handle('get-qq-music-url', async (_event, requestData: any, cookieString: string) => {
    try {
      logger.info('[Main] Getting QQ Music URL...');

      const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
          'Content-Type': 'application/json',
          'Referer': 'https://y.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Cookie': cookieString,
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json();
      logger.info('[Main] Got QQ Music URL response, code:', data.code);

      return { success: true, data };
    } catch (error) {
      logger.error('[Main] Get QQ Music URL failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  ipcMain.handle('get-qq-music-lyrics', async (_event, songmid: string, cookieString: string) => {
    try {
      logger.info('[Main] Getting lyrics for:', songmid);

      const response = await fetch(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?_=${Date.now()}` +
        `&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0` +
        `&platform=yqq.json&needNewCode=1&g_tk=5381&songmid=${songmid}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Referer': 'https://y.qq.com/',
            'Cookie': cookieString,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();

      if (result.code !== 0) {
        logger.warn('[Main] Lyrics API returned error code:', result.code);
        return { success: false, error: `API error code: ${result.code}` };
      }

      const lyricBase64 = result.lyric;
      if (!lyricBase64) {
        return { success: false, error: 'No lyrics available' };
      }

      const lyrics = Buffer.from(lyricBase64, 'base64').toString('utf-8');
      logger.info('[Main] Lyrics fetched, length:', lyrics.length);

      return { success: true, lyrics };
    } catch (error) {
      logger.error('[Main] Get lyrics failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  ipcMain.handle('fetch-cover-base64', async (_event, coverUrl: string) => {
    try {
      const response = await fetch(coverUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://y.qq.com/',
        },
      });
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mime = response.headers.get('content-type') || 'image/jpeg';
      return { success: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
