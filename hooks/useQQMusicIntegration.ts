import { useState, useCallback, useRef, useEffect } from 'react';
import { Track, ViewMode } from '../types';
import { QQMusicSong, qqMusicApi } from '../services/qqMusicApi';
import { cookieManager } from '../services/cookieManager';
import { settingsManager } from '../services/settingsManager';
import { webdavClient } from '../services/webdavClient';
import { generateMetaJson } from '../services/webdavMetaService';
import { notify } from '../services/notificationService';
import { parseLRCLyrics } from '../services/metadataService';
import { logger } from '../services/logger';
import { i18n } from '../services/i18n';

interface UseQQMusicIntegrationParams {
  setViewMode: (mode: ViewMode) => void;
  mergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
}

interface QQProgressEntry {
  type: 'download' | 'upload';
  percent: number;
}

/**
 * QQ Music integration: download to local disk or upload to WebDAV.
 *
 * Encapsulates lyrics/cover fetching, audio download, metadata writing,
 * WebDAV upload, and progress tracking. Leaf module — only depends on
 * setViewMode (to redirect to settings when path missing) and
 * mergeCloudTracks (to add uploaded tracks to the cloud slot).
 */
export function useQQMusicIntegration({ setViewMode, mergeCloudTracks }: UseQQMusicIntegrationParams) {
  const [qqProgress, setQqProgress] = useState<Record<string, QQProgressEntry>>({});
  const activeQqSongRef = useRef<string | null>(null);

  // Helper: fetch lyrics via IPC first, fallback to direct API
  const fetchLyrics = async (songmid: string, cookie: string): Promise<string | undefined> => {
    if (window.electron?.getQQMusicLyrics) {
      const r = await window.electron.getQQMusicLyrics(songmid, cookie);
      if (r?.success && r.lyrics) return r.lyrics;
    }
    return (await qqMusicApi.getLyrics(songmid)) || undefined;
  };

  // Helper: fetch cover as base64 data URL (via IPC to avoid CORS)
  const fetchCoverBase64 = async (coverUrl: string): Promise<string | undefined> => {
    if (window.electron?.fetchCoverBase64) {
      const r = await window.electron.fetchCoverBase64(coverUrl);
      if (r?.success && r.dataUrl) return r.dataUrl;
    }
    // Fallback: direct fetch (works with CORS bypass in Electron)
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
    } catch { return undefined; }
  };

  const handleQQMusicDownload = useCallback(async (song: QQMusicSong, quality: '128' | '320' | 'flac') => {
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) { setViewMode(ViewMode.SETTINGS); return; }
    const songmid = song.songmid;
    activeQqSongRef.current = songmid;
    setQqProgress(prev => ({ ...prev, [songmid]: { type: 'download', percent: 0 } }));
    try {
      const singer = song.singer?.map(s => s.name).join(' & ') || 'Unknown';
      const ext = quality === 'flac' ? 'flac' : 'mp3';
      const fileName = `${singer} - ${song.songname}.${ext}`;
      const rawCookie = cookieManager.getCookie();
      const coverUrl = song.albummid
        ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${song.albummid}.jpg`
        : song.coverUrl;
      const [lyrics, { url }] = await Promise.all([
        fetchLyrics(song.songmid, rawCookie),
        qqMusicApi.getMusicUrl(song.songmid, quality),
      ]);
      const fullPath = `${downloadPath}/${fileName}`;
      const result = await window.electron?.downloadAndSave?.(url, rawCookie, fullPath);
      if (!result?.success || !result.filePath) throw new Error('Download failed');
      setQqProgress(prev => ({ ...prev, [songmid]: { type: 'download', percent: 80 } }));
      if (window.electron?.writeAudioMetadata) {
        await window.electron.writeAudioMetadata(result.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
          ...(lyrics != null && { lyrics }),
          ...(coverUrl != null && { coverUrl }),
        });
      }
      setQqProgress(prev => ({ ...prev, [songmid]: { type: 'download', percent: 100 } }));
      notify(i18n.t('notifications.downloadComplete'), song.songname, { silent: true });
      setTimeout(() => setQqProgress(prev => { const n = { ...prev }; delete n[songmid]; return n; }), 3000);
    } catch (err: any) {
      logger.error('[QQMusic] download failed:', err);
      setQqProgress(prev => { const n = { ...prev }; delete n[songmid]; return n; });
      notify(i18n.t('notifications.downloadFailed'), err.message || '');
    } finally {
      if (activeQqSongRef.current === songmid) activeQqSongRef.current = null;
    }
  }, [setViewMode]);

  const handleQQMusicUpload = useCallback(async (song: QQMusicSong, quality: '128' | '320' | 'flac') => {
    if (!webdavClient.hasConfig()) { setViewMode(ViewMode.SETTINGS); return; }
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) { setViewMode(ViewMode.SETTINGS); return; }
    const songmid = song.songmid;
    activeQqSongRef.current = songmid;
    setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 0 } }));
    try {
      const singer = song.singer?.map(s => s.name).join(' & ') || 'Unknown';
      const ext = quality === 'flac' ? 'flac' : 'mp3';
      const fileName = `${singer} - ${song.songname}.${ext}`;
      const rawCookie = cookieManager.getCookie();
      const coverUrl = song.albummid
        ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${song.albummid}.jpg`
        : song.coverUrl;
      const [lyrics, { url }, coverBase64] = await Promise.all([
        fetchLyrics(song.songmid, rawCookie),
        qqMusicApi.getMusicUrl(song.songmid, quality),
        coverUrl ? fetchCoverBase64(coverUrl) : Promise.resolve(undefined),
      ]);
      const fullPath = `${downloadPath}/${fileName}`;
      const dlResult = await window.electron?.downloadAndSave?.(url, rawCookie, fullPath);
      if (!dlResult?.success || !dlResult.filePath) throw new Error('Download failed');
      setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 35 } }));
      if (window.electron?.writeAudioMetadata) {
        await window.electron.writeAudioMetadata(dlResult.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
          ...(lyrics != null && { lyrics }),
          ...(coverBase64 != null ? { coverUrl: coverBase64 } : coverUrl != null ? { coverUrl } : {}),
        });
      }
      setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 50 } }));
      const readResult = await window.electron?.readFile?.(dlResult.filePath);
      if (!readResult?.success || !readResult.data) throw new Error('Failed to read file for upload');
      const webdavPath = `/${fileName}`;
      setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 65 } }));
      await webdavClient.uploadFile(webdavPath, readResult.data, `audio/${ext}`);
      setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 85 } }));
      await webdavClient.uploadMetaJson(webdavPath, generateMetaJson({
        id: `webdav-${webdavPath}`, title: song.songname, artist: singer,
        album: song.albumname || '', duration: song.interval || 0, audioUrl: '',
        source: 'webdav', webdavPath, fileName, fileSize: readResult.data.byteLength,
        ...(lyrics != null && { lyrics }),
        ...(coverBase64 != null && { coverUrl: coverBase64 }),
      }));
      setQqProgress(prev => ({ ...prev, [songmid]: { type: 'upload', percent: 100 } }));
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
        ...(lyrics != null && { lyrics }),
        ...(lyrics != null ? (() => {
          const parsed = parseLRCLyrics(lyrics);
          return parsed.syncedLyrics != null ? { syncedLyrics: parsed.syncedLyrics } : {};
        })() : {}),
        ...(coverBase64 != null ? { coverUrl: coverBase64 } : coverUrl != null ? { coverUrl } : {}),
      };
      mergeCloudTracks([cloudTrack], [], []);
      notify(i18n.t('notifications.uploadComplete'), `${song.songname} → WebDAV`, { silent: true });
      setTimeout(() => setQqProgress(prev => { const n = { ...prev }; delete n[songmid]; return n; }), 3000);
    } catch (err: any) {
      logger.error('[QQMusic] upload failed:', err);
      setQqProgress(prev => { const n = { ...prev }; delete n[songmid]; return n; });
      notify(i18n.t('notifications.uploadFailed'), err.message || '');
    } finally {
      if (activeQqSongRef.current === songmid) activeQqSongRef.current = null;
    }
  }, [setViewMode, mergeCloudTracks]);

  // QQ Music download progress listener
  useEffect(() => {
    const handler = (data: { downloaded: number; total: number; progress: number }) => {
      const songmid = activeQqSongRef.current;
      if (!songmid) return;
      setQqProgress(prev => ({ ...prev, [songmid]: { type: 'download', percent: Math.round(data.progress) } }));
    };
    window.electron?.onDownloadProgress?.(handler);
    return () => { window.electron?.offDownloadProgress?.(handler); };
  }, []);

  return { qqProgress, handleQQMusicDownload, handleQQMusicUpload };
}
