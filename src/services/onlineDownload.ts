import { buildSafeMusicFileName, joinDownloadPath } from './fileName';
import type { OnlineMusicProvider, OnlineQuality, OnlineSong } from './onlineMusicProvider';

export const QUALITY_EXTENSION: Readonly<Record<OnlineQuality, string>> = {
  '128': 'mp3',
  '320': 'mp3',
  flac: 'flac',
  m4a: 'm4a',
};

export const QUALITY_LABEL: Readonly<Record<OnlineQuality, string>> = {
  '128': '128kbps',
  '320': '320kbps',
  flac: 'FLAC',
  m4a: 'M4A',
};

type SaveAudio = (url: string, cookie: string, filePath: string) =>
  Promise<{ success: boolean; filePath?: string; error?: string } | undefined>;

export interface SavedOnlineAudio {
  filePath: string;
  fileName: string;
  /** What the provider actually served; can be lower than requested. */
  served: OnlineQuality;
}

/**
 * Resolves the stream URL first, then names the file after the quality that
 * was actually served, so a song without FLAC never lands as an MP3 in a
 * `.flac` file.
 */
export async function saveOnlineAudio(options: {
  provider: OnlineMusicProvider;
  song: OnlineSong;
  quality: OnlineQuality;
  singer: string;
  downloadPath: string;
  save: SaveAudio | undefined;
}): Promise<SavedOnlineAudio> {
  const { provider, song, quality, singer, downloadPath, save } = options;
  if (!save) throw new Error('Downloading requires the desktop app');
  const { url, quality: served } = await provider.getMusicUrl(song.songmid, quality, song.mediaMid);
  const fileName = buildSafeMusicFileName(singer, song.songname, QUALITY_EXTENSION[served]);
  const result = await save(url, provider.getRawCookie(), joinDownloadPath(downloadPath, fileName));
  if (!result?.success || !result.filePath) throw new Error(result?.error || 'Download failed');
  return { filePath: result.filePath, fileName, served };
}
