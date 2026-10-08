import { ipcMain } from "electron";
import { logger } from "../logger";
import { readAudioMetadata, writeAudioMetadata } from "../services/audioMetadataService";

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
