/**
 * QQ Music → Local / WebDAV pipeline
 *
 * Orchestrates: search result → fetch lyrics/url → download → write metadata → (optional) upload to WebDAV.
 * UI state (progress, viewMode, active song ref) is injected via callbacks so this module stays UI-agnostic.
 */

import type { Track } from '../types';
import { ViewMode } from '../types';
import { QQMusicSong, qqMusicApi } from './qqMusicApi';
import { cookieManager } from './cookieManager';
import { settingsManager } from './settingsManager';
import { webdavClient } from './webdavClient';
import { generateMetaJson } from './webdavMetaService';
import { parseLRCLyrics } from './metadataService';
import { notify } from './notificationService';
import { i18n } from './i18n';
import { getDesktopAPI } from './desktopAdapter';
import { handleError, ErrorCode } from '../utils/errorHandler';

export type Quality = '128' | '320' | 'flac';

export type QqProgressMap = Record<string, { type: 'download' | 'upload'; percent: number }>;

export interface QQPipelineCallbacks {
  setQqProgress: (updater: (prev: QqProgressMap) => QqProgressMap) => void;
  setViewMode: (mode: ViewMode) => void;
  setActiveQqSong: (songmid: string | null) => void;
  /** Called when a track is uploaded to WebDAV — caller merges it into cloud slot */
  mergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
}

async function fetchLyrics(songmid: string, cookie: string): Promise<string | undefined> {
  if (window.electron?.getQQMusicLyrics) {
    const r = await window.electron.getQQMusicLyrics(songmid, cookie);
    if (r?.success && r.lyrics) return r.lyrics;
  }
  return (await qqMusicApi.getLyrics(songmid)) || undefined;
}

async function fetchCoverBase64(coverUrl: string): Promise<string | undefined> {
  if (window.electron?.fetchCoverBase64) {
    const r = await window.electron.fetchCoverBase64(coverUrl);
    if (r?.success && r.dataUrl) return r.dataUrl;
  }
  try {
    const resp = await fetch(coverUrl);
    if (!resp.ok) return undefined;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

interface DownloadPrep {
  singer: string;
  ext: string;
  fileName: string;
  cookie: string;
  coverUrl: string | undefined;
  lyrics: string | undefined;
  url: string;
  coverBase64: string | undefined;
  fullPath: string;
}

async function prepareDownload(
  song: QQMusicSong,
  quality: Quality,
  fetchCover: boolean,
  downloadPath: string,
): Promise<DownloadPrep> {
  const singer = song.singer?.map(s => s.name).join(' & ') || 'Unknown';
  const ext = quality === 'flac' ? 'flac' : 'mp3';
  const fileName = `${singer} - ${song.songname}.${ext}`;
  const cookie = cookieManager.getCookie();
  const coverUrl = song.albummid
    ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${song.albummid}.jpg`
    : song.coverUrl;
  const [lyrics, { url }, coverBase64] = await Promise.all([
    fetchLyrics(song.songmid, cookie),
    qqMusicApi.getMusicUrl(song.songmid, quality),
    fetchCover && coverUrl ? fetchCoverBase64(coverUrl) : Promise.resolve(undefined),
  ]);
  return {
    singer, ext, fileName, cookie, coverUrl, lyrics, url, coverBase64,
    fullPath: `${downloadPath}/${fileName}`,
  };
}

export async function downloadFromQQ(
  song: QQMusicSong,
  quality: Quality,
  cb: QQPipelineCallbacks,
): Promise<void> {
  const downloadPath = settingsManager.getDownloadPath();
  if (!downloadPath) { cb.setViewMode(ViewMode.SETTINGS); return; }

  const songmid = song.songmid;
  cb.setActiveQqSong(songmid);
  cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'download', percent: 0 } }));

  try {
    const prep = await prepareDownload(song, quality, false, downloadPath);
    const result = await window.electron?.downloadAndSave?.(prep.url, prep.cookie, prep.fullPath);
    if (!result?.success || !result.filePath) throw new Error('Download failed');
    cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'download', percent: 80 } }));

    const api = getDesktopAPI();
    if (api?.writeAudioMetadata) {
      await api.writeAudioMetadata(result.filePath, {
        title: song.songname, artist: prep.singer, album: song.albumname || '',
        ...(prep.lyrics != null && { lyrics: prep.lyrics }),
        ...(prep.coverUrl != null && { coverUrl: prep.coverUrl }),
      });
    }
    cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'download', percent: 100 } }));
    notify(i18n.t('notifications.downloadComplete'), song.songname, { silent: true });
    setTimeout(() => cb.setQqProgress(prev => { const n = { ...prev }; delete n[songmid]; return n; }), 3000);
  } catch (err) {
    const appErr = handleError(err, 'qqMusicPipeline.downloadFromQQ', {
      fallbackMessage: 'QQ Music download failed',
      code: ErrorCode.NETWORK_REQUEST_FAILED,
    });
    cb.setQqProgress(prev => { const n = { ...prev }; delete n[songmid]; return n; });
    notify(i18n.t('notifications.downloadFailed'), appErr.message);
  } finally {
    cb.setActiveQqSong(null);
  }
}

export async function uploadFromQQToWebDAV(
  song: QQMusicSong,
  quality: Quality,
  cb: QQPipelineCallbacks,
): Promise<void> {
  if (!webdavClient.hasConfig()) { cb.setViewMode(ViewMode.SETTINGS); return; }
  const downloadPath = settingsManager.getDownloadPath();
  if (!downloadPath) { cb.setViewMode(ViewMode.SETTINGS); return; }

  const songmid = song.songmid;
  cb.setActiveQqSong(songmid);
  cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 0 } }));

  try {
    const prep = await prepareDownload(song, quality, true, downloadPath);
    const dlResult = await window.electron?.downloadAndSave?.(prep.url, prep.cookie, prep.fullPath);
    if (!dlResult?.success || !dlResult.filePath) throw new Error('Download failed');
    cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 35 } }));

    const api = getDesktopAPI();
    if (api?.writeAudioMetadata) {
      await api.writeAudioMetadata(dlResult.filePath, {
        title: song.songname, artist: prep.singer, album: song.albumname || '',
        ...(prep.lyrics != null && { lyrics: prep.lyrics }),
        ...(prep.coverBase64 != null ? { coverUrl: prep.coverBase64 } : prep.coverUrl != null ? { coverUrl: prep.coverUrl } : {}),
      });
    }
    cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 50 } }));

    const readResult = api ? await api.readFile(dlResult.filePath) : null;
    if (!readResult?.success || !readResult.data) throw new Error('Failed to read file for upload');
    const webdavPath = `/${prep.fileName}`;
    cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 65 } }));

    await webdavClient.uploadFile(webdavPath, readResult.data, `audio/${prep.ext}`);
    cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 85 } }));

    await webdavClient.uploadMetaJson(webdavPath, generateMetaJson({
      id: `webdav-${webdavPath}`, title: song.songname, artist: prep.singer,
      album: song.albumname || '', duration: song.interval || 0, audioUrl: '',
      source: 'webdav', webdavPath, fileName: prep.fileName, fileSize: readResult.data.byteLength,
      ...(prep.lyrics != null && { lyrics: prep.lyrics }),
      ...(prep.coverBase64 != null && { coverUrl: prep.coverBase64 }),
    }));
    cb.setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 100 } }));

    const cloudTrack: Track = {
      id: `webdav-${webdavPath}`,
      title: song.songname,
      artist: prep.singer,
      album: song.albumname || 'Unknown Album',
      duration: song.interval || 0,
      audioUrl: '',
      source: 'webdav',
      webdavPath,
      fileName: prep.fileName,
      fileSize: readResult.data.byteLength,
      ...(prep.lyrics != null && { lyrics: prep.lyrics }),
      ...(prep.lyrics != null ? (() => {
        const parsed = parseLRCLyrics(prep.lyrics);
        return parsed.syncedLyrics != null ? { syncedLyrics: parsed.syncedLyrics } : {};
      })() : {}),
      ...(prep.coverBase64 != null ? { coverUrl: prep.coverBase64 } : prep.coverUrl != null ? { coverUrl: prep.coverUrl } : {}),
    };
    cb.mergeCloudTracks([cloudTrack], [], []);
    notify(i18n.t('notifications.uploadComplete'), `${song.songname} → WebDAV`, { silent: true });
    setTimeout(() => cb.setQqProgress(prev => { const n = { ...prev }; delete n[songmid]; return n; }), 3000);
  } catch (err) {
    const appErr = handleError(err, 'qqMusicPipeline.uploadFromQQToWebDAV', {
      fallbackMessage: 'QQ Music upload failed',
      code: ErrorCode.NETWORK_REQUEST_FAILED,
    });
    cb.setQqProgress(prev => { const n = { ...prev }; delete n[songmid]; return n; });
    notify(i18n.t('notifications.uploadFailed'), appErr.message);
  } finally {
    cb.setActiveQqSong(null);
  }
}
