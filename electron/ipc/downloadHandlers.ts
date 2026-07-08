import { ipcMain, dialog } from "electron";
import fs from "fs";
import path from "path";
import { logger } from "../logger";
import { expandHomeDir } from "../utils/fileUtils";
import { allowAudioPath } from "./typedHandlers";
export function registerDownloadHandlers(): void {
  ipcMain.handle('download-and-save', async (event, url: string, cookieString: string, filePath: string) => {
    try {
      const expandedPath = expandHomeDir(filePath);
      logger.info('[Main] Starting download to:', expandedPath);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Referer': 'https://y.qq.com/',
          'Cookie': cookieString,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const total = parseInt(response.headers.get('content-length') || '0');
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('ReadableStream not supported');
      }

      const dirPath = path.dirname(expandedPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const writer = fs.createWriteStream(expandedPath);
      let downloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writer.write(Buffer.from(value));
        downloaded += value.length;

        if (total > 0) {
          event.sender.send('download-progress', {
            downloaded,
            total,
            progress: Math.round((downloaded / total) * 100)
          });
        }

        await new Promise(resolve => setImmediate(resolve));
      }

      writer.end();
      await new Promise<void>(resolve => writer.on('finish', resolve));
      allowAudioPath(expandedPath);

      logger.info('[Main] Download completed, size:', downloaded, 'bytes');
      return { success: true, filePath: expandedPath, size: downloaded };
    } catch (error) {
      logger.error('[Main] Download failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('download-audio-file', async (event, url: string, cookieString: string) => {
    try {
      logger.info('[Main] Starting streaming download from:', url.substring(0, 100) + '...');

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Referer': 'https://y.qq.com/',
          'Cookie': cookieString,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const total = parseInt(response.headers.get('content-length') || '0');
      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('ReadableStream not supported');
      }

      const chunks: Uint8Array[] = [];
      let downloaded = 0;
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        downloaded += value.length;
        chunkCount++;

        if (chunkCount % 50 === 0 && total > 0) {
          event.sender.send('download-progress', {
            downloaded,
            total,
            progress: Math.round((downloaded / total) * 100)
          });
        }

        if (chunkCount % 100 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }

      const allChunks = new Uint8Array(downloaded);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }

      logger.info('[Main] Download completed, size:', downloaded, 'bytes');

      return {
        success: true,
        data: allChunks.buffer
      };
    } catch (error) {
      logger.error('[Main] Download failed:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  ipcMain.handle('select-download-folder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: '选择下载目录'
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, path: result.filePaths[0] };
      }
      return { success: false, canceled: true };
    } catch (error) {
      logger.error('[Main] Select folder failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('save-file-to-path', async (_event, dirPath: string, fileName: string, fileData: ArrayBuffer) => {
    try {
      const expandedDir = expandHomeDir(dirPath);
      const fullPath = path.join(expandedDir, fileName);
      logger.info('[Main] Saving file to:', fullPath);

      if (!fs.existsSync(expandedDir)) {
        fs.mkdirSync(expandedDir, { recursive: true });
        logger.info('[Main] Created directory:', expandedDir);
      }

      const buffer = Buffer.from(fileData);
      fs.writeFileSync(fullPath, buffer);
      allowAudioPath(fullPath);

      logger.info('[Main] File saved successfully, size:', buffer.length);
      return { success: true, filePath: fullPath };
    } catch (error) {
      logger.error('[Main] Save file failed:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

