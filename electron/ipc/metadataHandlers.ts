import { ipcMain } from "electron";
import { logger } from "../logger";
import { readAudioMetadata, writeAudioMetadata } from "../services/audioMetadataService";
import { qqMusicHeaders } from "../utils/httpHeaders";

export function registerMetadataHandlers(): void {
  // ── Read metadata (music-tag-native) ────────────────────────────────
  ipcMain.handle('read-audio-metadata', async (_event, filePath: string) => {
    try {
      const metadata = await readAudioMetadata(filePath);
      return { success: true, metadata };
    } catch (error) {
      logger.error('[Main] Read metadata failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ── Write metadata (music-tag-native + custom QRC/YRC) ─────────────
  ipcMain.handle('write-audio-metadata', async (_event, filePath: string, metadata: {
    title?: string;
    artist?: string;
    album?: string;
    lyrics?: string;
    coverUrl?: string;
    wordLyrics?: string;
    wordLyricsFormat?: 'qrc' | 'yrc';
  }) => {
    try {
      await writeAudioMetadata(filePath, {
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        lyrics: metadata.lyrics,
        wordLyrics: metadata.wordLyrics,
        wordLyricsFormat: metadata.wordLyricsFormat,
        coverDataUri: metadata.coverUrl,
      });
      return { success: true };
    } catch (error) {
      logger.error('[Main] Write metadata failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ── Refresh metadata (now uses music-tag-native, same as read-audio-metadata) ──
  ipcMain.handle('refresh-track-metadata', async (_event, filePath: string) => {
    try {
      const metadata = await readAudioMetadata(filePath);
      return { success: true, metadata };
    } catch (error) {
      logger.error('[Main] Refresh metadata failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

/**
 * Resolve a QQ Music stream URL from songmid + quality + cookie (vkey flow).
 * Shared by the existing IPC handler and the `stream://` protocol handler.
 */
export async function qqResolveStreamUrl(songmid: string, quality: string, cookie: string): Promise<string> {
  const fileConfig: Record<string, { s: string; e: string }> = {
    m4a: { s: 'C400', e: '.m4a' },
    '128': { s: 'M500', e: '.mp3' },
    '320': { s: 'M800', e: '.mp3' },
    flac: { s: 'F000', e: '.flac' },
  };
  const cfg = fileConfig[quality] ?? fileConfig['320']!;
  const file = `${cfg.s}${songmid}${songmid}${cfg.e}`;
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
    comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
  };
  const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...qqMusicHeaders(cookie),
    },
    body: JSON.stringify(reqData),
  });
  if (!response.ok) throw new Error(`QQ vkey HTTP ${response.status}`);
  const data = await response.json();
  const purl = data?.req_1?.data?.midurlinfo?.[0]?.purl;
  const sip = data?.req_1?.data?.sip?.[0] ?? '';
  if (!purl) throw new Error('QQ vkey: empty purl (cookie may be expired or song unavailable)');
  return sip + purl;
}

