import { logger } from './logger';
import { cookieManager } from './cookieManager';

export interface QQMusicSong {
  songmid: string;
  songname: string;
  singer: { name: string; mid?: string }[];
  albumname?: string;
  albummid?: string;
  interval?: number; // duration in seconds
  coverUrl?: string;
}

export interface QQMusicSearchResult {
  list: QQMusicSong[];
  total: number;
}

export interface QQMusicUrlResult {
  url: string;
  bitrate: string;
}

// Extended Electron API for QQ Music-specific operations
interface QQMusicElectronAPI {
  getQQMusicUrl?: (reqData: Record<string, unknown>, cookie: string) => Promise<unknown>;
  getQQMusicLyrics?: (songmid: string, cookie: string) => Promise<{ success: boolean; lyrics?: string; error?: string }>;
  downloadAudioFile?: (url: string, cookie: string) => Promise<{ success: boolean; data?: number[] | ArrayBuffer; error?: string }>;
  downloadAndSave?: (url: string, cookie: string, filePath: string) => Promise<{ success: boolean; filePath?: string; size?: number; error?: string }>;
  saveFileToPath?: (dirPath: string, fileName: string, fileData: ArrayBuffer) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  writeAudioMetadata?: (
    filePath: string,
    metadata: { title?: string; artist?: string; album?: string; lyrics?: string; coverUrl?: string }
  ) => Promise<{ success: boolean; error?: string }>;
  onDownloadProgress?: (callback: (progress: { downloaded: number; total: number; progress: number }) => void) => void;
  offDownloadProgress?: (callback: (progress: { downloaded: number; total: number; progress: number }) => void) => void;
}

declare global {
  interface Window {
    electron?: import('./desktopAdapter').DesktopAPI & QQMusicElectronAPI;
  }
}



class QQMusicAPI {
  private baseHeaders = {
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'Referer': 'https://y.qq.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  };

  private mobileHeaders = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36 Edg/123.0.0.0',
    'Referer': 'https://y.qq.com/',
  };

  private handleFetchError(error: Error | unknown, context: string): never {
    logger.error(`[QQMusicAPI] ${context} failed:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Cookie')) {
      throw error;
    }

    throw new Error(`${context}失败: ${errorMessage || '未知错误'}`);
  }

  private getCookieHeaders(): Record<string, string> {
    const cookies = cookieManager.parseCookie();
    logger.debug('[QQMusicAPI] All parsed cookies:', Object.keys(cookies));

    // Filter out cookies with non-ASCII characters in value to avoid fetch API errors
    // Only include standard ASCII characters (0-127) in cookie values
    const safeCookies: Record<string, string> = {};
    const skippedCookies: string[] = [];
    for (const [key, value] of Object.entries(cookies)) {
      // Check if value contains only ASCII characters
      if (this.isAsciiOnly(value)) {
        safeCookies[key] = value;
      } else {
        // Try to encode the value, but skip if it can't be properly encoded
        skippedCookies.push(key);
        // Check if it's a critical cookie
        const criticalCookies = ['p_skey', 'skey', 'p_uin', 'uin', 'qm_keyst', 'qq_music_key', 'tmeAdGuid'];
        if (criticalCookies.some(c => key.toLowerCase().includes(c))) {
          logger.warn(`[QQMusicAPI] Critical cookie '${key}' was filtered due to non-ASCII characters!`);
        }
      }
    }

    if (skippedCookies.length > 0) {
      logger.debug('[QQMusicAPI] Skipped cookies due to non-ASCII:', skippedCookies);
    }
    logger.debug('[QQMusicAPI] Safe cookies:', Object.keys(safeCookies));
    
    const cookieString = Object.entries(safeCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    
    return {
      ...this.baseHeaders,
      'Cookie': cookieString,
    };
  }

  private isAsciiOnly(str: string): boolean {
    // Check if string contains only ISO-8859-1 characters (char code 0-255)
    // fetch API requires headers to be ISO-8859-1 encoded
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 255) {
        return false;
      }
    }
    return true;
  }

  /**
   * Search for songs by name
   */
  async searchMusic(query: string, limit: number = 20): Promise<QQMusicSong[]> {
    if (!cookieManager.hasCookie()) {
      throw new Error('Cookie not set');
    }

    const data = {
      comm: {
        g_tk: 997034911,
        uin: this.generateRandomUin(),
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'h5',
        needNewCode: 1,
        ct: 23,
        cv: 0,
      },
      req_0: {
        method: 'DoSearchForQQMusicDesktop',
        module: 'music.search.SearchCgiService',
        param: {
          remoteplace: 'txt.mqq.all',
          searchid: this.generateSearchId(),
          search_type: 0,
          query: query,
          page_num: 1,
          num_per_page: limit,
        },
      },
    };

    try {
      const response = await fetch(
        `https://u.y.qq.com/cgi-bin/musicu.fcg?_webcgikey=DoSearchForQQMusicDesktop&_=${Date.now()}`,
        {
          method: 'POST',
          headers: this.getCookieHeaders(),
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.code === 500001) {
        throw new Error('Cookie expired or invalid');
      }

      const songs = result.req_0?.data?.body?.song?.list || [];
      return songs.map((song: any) => this.normalizeSong(song));
    } catch (error: any) {
      this.handleFetchError(error, '搜索');
    }
  }

  /**
   * Get detailed song info by songmid
   */
  async getSongDetails(songmids: string[]): Promise<QQMusicSong[]> {
    if (!cookieManager.hasCookie()) {
      throw new Error('Cookie not set');
    }

    const data = {
      comm: {
        cv: 4747474,
        ct: 24,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 1,
        uin: this.generateRandomUin(),
        g_tk_new_20200303: 708550273,
        g_tk: 708550273,
      },
      req_1: {
        module: 'music.trackInfo.UniformRuleCtrl',
        method: 'CgiGetTrackInfo',
        param: {
          ids: songmids.map(() => 0), // IDs will be resolved by mid
          types: songmids.map(() => 0),
          mids: songmids,
        },
      },
    };

    try {
      const response = await fetch(
        `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(data))}`,
        {
          headers: this.getCookieHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.code === 500001) {
        throw new Error('Cookie expired or invalid');
      }

      const tracks = result.req_1?.data?.tracks || [];
      return tracks.map((track: any) => this.normalizeSongFromTrack(track));
    } catch (error: any) {
      this.handleFetchError(error, '获取歌曲详情');
    }
  }

  /**
   * Get music URL for playback/download
   */
  async getMusicUrl(songmid: string, quality: 'm4a' | '128' | '320' | 'flac' = '128'): Promise<QQMusicUrlResult> {
    if (!cookieManager.hasCookie()) {
      throw new Error('Cookie not set');
    }

    const fileConfig: Record<string, { s: string; e: string; bitrate: string }> = {
      m4a: { s: 'C400', e: '.m4a', bitrate: 'M4A' },
      '128': { s: 'M500', e: '.mp3', bitrate: '128kbps' },
      '320': { s: 'M800', e: '.mp3', bitrate: '320kbps' },
      flac: { s: 'F000', e: '.flac', bitrate: 'FLAC' },
    };

    const config = fileConfig[quality];
    const file = `${config.s}${songmid}${songmid}${config.e}`;

    const reqData = {
      req_1: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          filename: [file],
          guid: '10000',
          songmid: [songmid],
          songtype: [0],
          uin: '0',
          loginflag: 1,
          platform: '20',
        },
      },
      loginUin: '0',
      comm: {
        uin: '0',
        format: 'json',
        ct: 24,
        cv: 0,
      },
    };

    try {
      logger.debug('[QQMusicAPI] Getting music URL for:', songmid, 'quality:', quality);
      logger.debug('[QQMusicAPI] Request file:', file);

      // Use Electron main process to get URL (ensures cookies are properly sent)
      logger.debug('[QQMusicAPI] Using Electron main process for getMusicUrl');

      const rawCookie = cookieManager.getCookie();
      logger.debug('[QQMusicAPI] Raw cookie length:', rawCookie.length);

      const ipcResult = await window.electron!.getQQMusicUrl(reqData, rawCookie) as { success: boolean; error?: string; data?: unknown };

      if (!ipcResult.success) {
        throw new Error(ipcResult.error || 'Failed to get music URL');
      }

      const result = ipcResult.data;
      logger.debug('[QQMusicAPI] Got response from main process, code:', (result as { code?: number })?.code);
      logger.debug('[QQMusicAPI] Music URL response:', result);

      const purl = (result as { req_1?: { data?: { midurlinfo?: [{ purl?: string; code?: number | string; }]; sip?: string[]; }; }; }).req_1?.data?.midurlinfo?.[0]?.purl;
      const code = (result as { req_1?: { data?: { midurlinfo?: [{ code?: number | string; }]; }; }; }).req_1?.data?.midurlinfo?.[0]?.code;
      const info = (result as { req_1?: { data?: { midurlinfo?: [unknown]; }; }; }).req_1?.data?.midurlinfo?.[0];
      const sipList = (result as { req_1?: { data?: { sip?: string[]; }; }; }).req_1?.data?.sip;
      logger.debug('[QQMusicAPI] midurlinfo:', info);
      logger.debug('[QQMusicAPI] sip list:', sipList);
      logger.debug('[QQMusicAPI] purl:', purl, 'code:', code);

      if (!purl) {
        // Log the full response for debugging
        logger.debug('[QQMusicAPI] Empty purl, full midurlinfo:', info);
        logger.debug('[QQMusicAPI] Response code:', code, 'type:', typeof code);

        // Convert code to number for comparison (API may return string)
        const codeNum = typeof code === 'string' ? parseInt(code, 10) : code;

        if (codeNum === 800004 || codeNum === 800001) {
          throw new Error('VIP required');
        }
        if (codeNum === 800002) {
          throw new Error('Copyright restricted');
        }
        // code 0 means API call succeeded but purl is empty - usually due to invalid cookie
        if (codeNum === 0 || codeNum === undefined || codeNum === null) {
          throw new Error('Cookie expired or invalid - please update your QQ Music cookie');
        }
        // Try fallback to 128kbps if higher quality failed
        if (quality !== '128') {
          logger.debug('[QQMusicAPI] Quality', quality, 'failed, trying 128kbps...');
          return this.getMusicUrl(songmid, '128');
        }
        throw new Error(`Cannot get download link (code: ${codeNum !== undefined ? codeNum : 'unknown'})`);
      }

      const sip = (result as { req_1?: { data?: { sip?: [string]; }; }; }).req_1?.data?.sip?.[0] || 'http://dl.stream.qqmusic.qq.com/';
      const url = sip + purl;
      logger.debug('[QQMusicAPI] Final URL:', url);

      return { url, bitrate: config.bitrate };
    } catch (error: unknown) {
      this.handleFetchError(error, '获取音乐链接');
    }
  }

  /**
   * Get recommended songs (hot songs)
   */
  async getRecommendedSongs(): Promise<QQMusicSong[]> {
    if (!cookieManager.hasCookie()) {
      throw new Error('Cookie not set');
    }

    // Use top list API to get popular songs - more reliable than HTML parsing
    const data = {
      comm: {
        cv: 4747474,
        ct: 24,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'yqq.json',
        needNewCode: 1,
        uin: this.generateRandomUin(),
        g_tk_new_20200303: 5381,
        g_tk: 5381,
      },
      req_1: {
        module: 'musicToplist.ToplistInfoServer',
        method: 'GetDetail',
        param: {
          topid: 26, // 热歌榜
          offset: 0,
          num: 30,
          period: '',
        },
      },
    };

    try {
      logger.debug('[QQMusicAPI] Fetching recommended songs...');
      const response = await fetch(
        `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(data))}`,
        {
          headers: this.getCookieHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      logger.debug('[QQMusicAPI] Response:', result);

      if (result.code === 500001) {
        throw new Error('Cookie expired or invalid');
      }

      // API returns songInfoList, not songInfo.list
      const songList = result.req_1?.data?.songInfoList || [];
      logger.debug('[QQMusicAPI] Song list:', songList.length, 'songs');

      if (!songList || songList.length === 0) {
        logger.warn('[QQMusicAPI] No songs returned, checking response structure:', result.req_1?.data);
      }

      return songList.map((song: unknown) => this.normalizeSongFromTrack(song as Record<string, unknown>));
    } catch (error: unknown) {
      this.handleFetchError(error, '获取推荐');
    }
  }

  /**
   * Get songs from a playlist
   */
  async getPlaylistSongs(playlistId: string, songBegin: number = 0, songNum: number = 30): Promise<QQMusicSong[]> {
    if (!cookieManager.hasCookie()) {
      throw new Error('Cookie not set');
    }

    const data = {
      comm: {
        g_tk: 5381,
        uin: '',
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'h5',
        needNewCode: 1,
      },
      req_0: {
        module: 'srf_diss_info.DissInfoServer',
        method: 'CgiGetDiss',
        param: {
          disstid: playlistId,
          onlysonglist: 1,
          song_begin: songBegin,
          song_num: songNum,
        },
      },
    };

    try {
      const response = await fetch(
        `https://u.y.qq.com/cgi-bin/musicu.fcg?_webcgikey=uniform_get_Dissinfo&_=${Date.now()}`,
        {
          method: 'POST',
          headers: this.getCookieHeaders(),
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.code === 500001) {
        throw new Error('Cookie expired or invalid');
      }

      const songList = result.req_0?.data?.songlist || [];
      return songList.map((song: any) => this.normalizeSong(song));
    } catch (error: any) {
      this.handleFetchError(error, '获取歌单歌曲');
    }
  }

  /**
   * Download audio file
   */
  async downloadAudio(
    songmid: string,
    songName: string,
    singer: string,
    quality: 'm4a' | '128' | '320' | 'flac' = '128',
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<Blob> {
    logger.debug('[QQMusicAPI] Starting download for:', songName, 'songmid:', songmid);
    const { url, bitrate } = await this.getMusicUrl(songmid, quality);
    logger.debug('[QQMusicAPI] Got download URL:', url, 'bitrate:', bitrate);

    // Use Electron main process to download (ensures cookies are properly sent)
    logger.debug('[QQMusicAPI] Using Electron main process for download');

    try {
      const rawCookie = cookieManager.getCookie();
      logger.debug('[QQMusicAPI] Raw cookie length:', rawCookie.length);

      // Set up progress listener if available
      let progressListener: ((data: { downloaded: number; total: number; progress: number }) => void) | null = null;
      if (onProgress && window.electron?.onDownloadProgress) {
        progressListener = (data: { downloaded: number; total: number; progress: number }) => {
          onProgress(data.downloaded, data.total);
        };
        window.electron.onDownloadProgress(progressListener);
      }

      let result;
      try {
        result = await window.electron!.downloadAudioFile(url, rawCookie);
      } finally {
        // Clean up progress listener
        if (progressListener && window.electron?.offDownloadProgress) {
          window.electron.offDownloadProgress(progressListener);
        }
      }

      if (!result.success) {
        throw new Error(result.error || 'Download failed');
      }

      // Convert returned data back to Uint8Array
      const rawData = result.data;
      if (!rawData) {
        throw new Error('Empty download data');
      }
      const data = rawData instanceof ArrayBuffer ? new Uint8Array(rawData) : new Uint8Array(rawData);
      logger.debug('[QQMusicAPI] Download completed via Electron, size:', data.byteLength);

      // Final progress update
      if (onProgress) {
        onProgress(data.byteLength, data.byteLength);
      }

      return new Blob([data]);
    } catch (error: unknown) {
      logger.error('[QQMusicAPI] Electron download failed:', error);
      throw error;
    }
  }

  /**
   * Get lyrics for a song by songmid
   */
  async getLyrics(songmid: string): Promise<string | null> {
    if (!cookieManager.hasCookie()) {
      throw new Error('Cookie not set');
    }

    try {
      logger.debug('[QQMusicAPI] Getting lyrics for:', songmid);

      const response = await fetch(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?_=${Date.now()}` +
        `&cv=4747474&ct=24&format=json&inCharset=utf-8&outCharset=utf-8&notice=0` +
        `&platform=yqq.json&needNewCode=1&g_tk=5381&songmid=${songmid}`,
        {
          headers: this.getCookieHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      logger.debug('[QQMusicAPI] Lyrics response code:', result.code);

      if (result.code !== 0) {
        logger.warn('[QQMusicAPI] Lyrics API returned error code:', result.code);
        return null;
      }

      // Decode base64 lyrics
      const lyricBase64 = result.lyric;
      if (!lyricBase64) {
        logger.debug('[QQMusicAPI] No lyrics available');
        return null;
      }

      // Base64 decode
      const lyrics = atob(lyricBase64);
      logger.debug('[QQMusicAPI] Lyrics decoded, length:', lyrics.length);

      return lyrics;
    } catch (error: unknown) {
      logger.error('[QQMusicAPI] Get lyrics failed:', error);
      return null;
    }
  }

  /**
   * Get album cover URL
   */
  getAlbumCoverUrl(albummid: string, size: number = 300): string {
    return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${albummid}.jpg`;
  }

  /**
   * Get song cover URL
   */
  getSongCoverUrl(songmid: string, size: number = 300): string {
    return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${songmid}.jpg`;
  }

  private normalizeSong(song: any): QQMusicSong {
    const albummid = song.albummid || song.album?.mid;
    return {
      songmid: song.songmid || song.mid,
      songname: song.songname || song.name || song.title,
      singer: song.singer || song.singers || [{ name: 'Unknown' }],
      albumname: song.albumname || song.album?.name,
      albummid: albummid,
      interval: song.interval || song.duration,
      coverUrl: albummid ? this.getAlbumCoverUrl(albummid) : undefined,
    };
  }

  private normalizeSongFromTrack(track: any): QQMusicSong {
    const albummid = track.album?.mid;
    return {
      songmid: track.mid,
      songname: track.name || track.title,
      singer: track.singer?.map((s: any) => ({ name: s.name, mid: s.mid })) || [{ name: 'Unknown' }],
      albumname: track.album?.name,
      albummid: albummid,
      interval: track.interval,
      coverUrl: albummid ? this.getAlbumCoverUrl(albummid) : undefined,
    };
  }

  private generateRandomUin(): string {
    return Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
  }

  private generateSearchId(): string {
    const chars = '0123456789';
    return Array.from({ length: 18 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}

export const qqMusicApi = new QQMusicAPI();
