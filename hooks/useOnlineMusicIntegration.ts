import { useState, useCallback, useRef, useEffect } from 'react';
import { Track, ViewMode } from '../types';
import {
  getOnlineProvider,
  type OnlineMusicProvider,
  type OnlineQuality,
  type OnlineSong,
} from '../services/onlineMusicProvider';
import { settingsManager } from '../services/settingsManager';
import { webdavClient } from '../services/webdavClient';
import { generateMetaJson } from '../services/webdavMetaService';
import { notify } from '../services/notificationService';
import { parseLRCLyrics } from '../services/metadataService';
import { logger } from '../services/logger';
import { i18n } from '../services/i18n';

interface UseOnlineMusicIntegrationParams {
  setViewMode: (mode: ViewMode) => void;
  mergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
}

interface OnlineProgressEntry {
  type: 'download' | 'upload';
  percent: number;
}

/**
 * Online music integration (QQ Music / NetEase Cloud Music): download to local
 * disk or upload to WebDAV, for whichever source is active in settings.
 *
 * Source-agnostic: every call resolves the active provider fresh, so switching
 * the online source in settings takes effect immediately.
 */
export function useOnlineMusicIntegration({ setViewMode, mergeCloudTracks }: UseOnlineMusicIntegrationParams) {
  const [onlineProgress, setOnlineProgress] = useState<Record<string, OnlineProgressEntry>>({});
  const activeSongRef = useRef<string | null>(null);

  // Lyrics: QQ prefers the dedicated IPC channel (avoids CORS), then falls back
  // to the provider. NetEase resolves entirely through its provider (IPC).
  const fetchLyrics = async (song: OnlineSong, provider: OnlineMusicProvider): Promise<string | undefined> => {
    if (provider.id === 'qq' && window.electron?.getQQMusicLyrics) {
      const r = await window.electron.getQQMusicLyrics(song.songmid, provider.getRawCookie());
      if (r?.success && r.lyrics) return r.lyrics;
    }
    return (await provider.getLyrics(song.songmid)) || undefined;
  };

  // Fetch cover as a base64 data URL (via IPC to avoid CORS).
  const fetchCoverBase64 = async (coverUrl: string): Promise<string | undefined> => {
    if (!coverUrl) return undefined;
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
  };

  const handleOnlineDownload = useCallback(async (song: OnlineSong, quality: OnlineQuality) => {
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) { setViewMode(ViewMode.SETTINGS); return; }
    const provider = getOnlineProvider();
    const songId = song.songmid;
    activeSongRef.current = songId;
    setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 0 } }));
    try {
      const singer = song.singer?.map((s) => s.name).join(' & ') || 'Unknown';
      const ext = quality === 'flac' ? 'flac' : 'mp3';
      const fileName = `${singer} - ${song.songname}.${ext}`;
      const cookie = provider.getRawCookie();
      const coverUrl = provider.getCoverUrl(song);
      const [lyrics, { url }] = await Promise.all([
        fetchLyrics(song, provider),
        provider.getMusicUrl(song.songmid, quality),
      ]);
      const fullPath = `${downloadPath}/${fileName}`;
      const result = await window.electron?.downloadAndSave?.(url, cookie, fullPath);
      if (!result?.success || !result.filePath) throw new Error('Download failed');
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 80 } }));
      if (window.electron?.writeAudioMetadata) {
        await window.electron.writeAudioMetadata(result.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
          ...(lyrics != null && { lyrics }),
          ...(coverUrl != null && { coverUrl }),
        });
      }
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 100 } }));
      notify(i18n.t('notifications.downloadComplete'), song.songname, { silent: true });
      setTimeout(() => setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; }), 3000);
    } catch (err: unknown) {
      logger.error('[OnlineMusic] download failed:', err);
      setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; });
      notify(i18n.t('notifications.downloadFailed'), err instanceof Error ? err.message : '');
    } finally {
      if (activeSongRef.current === songId) activeSongRef.current = null;
    }
  }, [setViewMode]);

  const handleOnlineUpload = useCallback(async (song: OnlineSong, quality: OnlineQuality) => {
    if (!webdavClient.hasConfig()) { setViewMode(ViewMode.SETTINGS); return; }
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) { setViewMode(ViewMode.SETTINGS); return; }
    const provider = getOnlineProvider();
    const songId = song.songmid;
    activeSongRef.current = songId;
    setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 0 } }));
    try {
      const singer = song.singer?.map((s) => s.name).join(' & ') || 'Unknown';
      const ext = quality === 'flac' ? 'flac' : 'mp3';
      const fileName = `${singer} - ${song.songname}.${ext}`;
      const cookie = provider.getRawCookie();
      const coverUrl = provider.getCoverUrl(song);
      const [lyrics, { url }, coverBase64] = await Promise.all([
        fetchLyrics(song, provider),
        provider.getMusicUrl(song.songmid, quality),
        coverUrl ? fetchCoverBase64(coverUrl) : Promise.resolve(undefined),
      ]);
      const fullPath = `${downloadPath}/${fileName}`;
      const dlResult = await window.electron?.downloadAndSave?.(url, cookie, fullPath);
      if (!dlResult?.success || !dlResult.filePath) throw new Error('Download failed');
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 35 } }));
      if (window.electron?.writeAudioMetadata) {
        await window.electron.writeAudioMetadata(dlResult.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
          ...(lyrics != null && { lyrics }),
          ...(coverBase64 != null ? { coverUrl: coverBase64 } : coverUrl != null ? { coverUrl } : {}),
        });
      }
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 50 } }));
      const readResult = await window.electron?.readFile?.(dlResult.filePath);
      if (!readResult?.success || !readResult.data) throw new Error('Failed to read file for upload');
      const webdavPath = `/${fileName}`;
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 65 } }));
      await webdavClient.uploadFile(webdavPath, readResult.data, `audio/${ext}`);
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 85 } }));
      await webdavClient.uploadMetaJson(webdavPath, generateMetaJson({
        id: `webdav-${webdavPath}`, title: song.songname, artist: singer,
        album: song.albumname || '', duration: song.interval || 0, audioUrl: '',
        source: 'webdav', webdavPath, fileName, fileSize: readResult.data.byteLength,
        ...(lyrics != null && { lyrics }),
        ...(coverBase64 != null ? { coverUrl: coverBase64 } : {}),
      }));
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 100 } }));
      // Add track to cloud slot immediately
      const cloudTrack: Track = {
        id: `webdav-${webdavPath}`,
        title: song.songname,
        artist: singer,
        album: song.albumname || 'Unknown Album',
        duration: song.interval || 0,
        audioUrl: '',
        source: 'webdav',
        webdavPath,
        fileName,
        fileSize: readResult.data.byteLength,
        // 上传时间作为排序键：刚上传=最新，排序后落在列表最底部（与 WebDAV 上传一致）。
        lastModified: Date.now(),
        ...(lyrics != null && { lyrics }),
        ...(lyrics != null ? (() => {
          const parsed = parseLRCLyrics(lyrics);
          return parsed.syncedLyrics != null ? { syncedLyrics: parsed.syncedLyrics } : {};
        })() : {}),
        ...(coverBase64 != null ? { coverUrl: coverBase64 } : coverUrl != null ? { coverUrl } : {}),
      };
      mergeCloudTracks([cloudTrack], [], []);
      notify(i18n.t('notifications.uploadComplete'), `${song.songname} → WebDAV`, { silent: true });
      setTimeout(() => setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; }), 3000);
    } catch (err: unknown) {
      logger.error('[OnlineMusic] upload failed:', err);
      setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; });
      notify(i18n.t('notifications.uploadFailed'), err instanceof Error ? err.message : '');
    } finally {
      if (activeSongRef.current === songId) activeSongRef.current = null;
    }
  }, [setViewMode, mergeCloudTracks]);

  // Download progress listener (forwarded from main process).
  useEffect(() => {
    const handler = (data: { downloaded: number; total: number; progress: number }) => {
      const songId = activeSongRef.current;
      if (!songId) return;
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: Math.round(data.progress) } }));
    };
    window.electron?.onDownloadProgress?.(handler);
    return () => { window.electron?.offDownloadProgress?.(handler); };
  }, []);

  return { onlineProgress, handleOnlineDownload, handleOnlineUpload };
}
