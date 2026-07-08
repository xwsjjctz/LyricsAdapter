import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { logger } from "../logger";
import { expandHomeDir } from "../utils/fileUtils";
import { writeAudioMetadata } from "../utils/metadataUtils";
export function registerMetadataHandlers(): void {
  ipcMain.handle('write-audio-metadata', async (_event, filePath: string, metadata: {
    title?: string;
    artist?: string;
    album?: string;
    lyrics?: string;
    coverUrl?: string;
  }) => {
    try {
      return await writeAudioMetadata(filePath, metadata);
    } catch (error) {
      logger.error('[Main] Write metadata failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('refresh-track-metadata', async (_event, filePath: string) => {
    try {
      const expandedPath = expandHomeDir(filePath);
      logger.info('[Main] Refreshing metadata for:', expandedPath);

      if (!fs.existsSync(expandedPath)) {
        return { success: false, error: '文件不存在' };
      }

      const fileData = fs.readFileSync(expandedPath);
      logger.info('[Main] File size:', fileData.length, 'bytes');

      const ext = path.extname(expandedPath).toLowerCase();
      const fileName = path.basename(expandedPath);
      let mimeType = 'audio/mpeg';
      if (ext === '.flac') {
        mimeType = 'audio/flac';
      } else if (ext === '.m4a' || ext === '.mp4') {
        mimeType = 'audio/mp4';
      }

      return {
        success: true,
        data: {
          fileName,
          mimeType,
          buffer: fileData.buffer
        }
      };
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
      Referer: 'https://y.qq.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      Cookie: cookie,
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

