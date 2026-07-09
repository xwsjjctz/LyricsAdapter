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
import { metadataCacheService } from '../services/metadataCacheService';
import { logger } from '../services/logger';
import { useTranslation } from 'react-i18next';
import { buildSafeMusicFileName, joinDownloadPath } from '../services/fileName';
import { getDesktopAPI, getDesktopAPIAsync } from '../services/desktopAdapter';

interface UseOnlineMusicIntegrationParams {
  setViewMode: (mode: ViewMode) => void;
  mergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
  /** Invoked after a download completes and the track is built (adds to local library). */
  onDownloadComplete?: (track: Track) => void;
}

export interface OnlineProgressEntry {
  type: 'download' | 'upload';
  percent: number;
  status?: 'completed' | 'error';
}

/**
 * Online music integration (QQ Music / NetEase Cloud Music): download to local
 * disk or upload to WebDAV, for whichever source is active in settings.
 *
 * Source-agnostic: every call resolves the active provider fresh, so switching
 * the online source in settings takes effect immediately.
 */
export function useOnlineMusicIntegration({ setViewMode, mergeCloudTracks, onDownloadComplete }: UseOnlineMusicIntegrationParams) {
  const [onlineProgress, setOnlineProgress] = useState<Record<string, OnlineProgressEntry>>({});
  const activeSongRef = useRef<string | null>(null);
  const { t } = useTranslation();

  // Lyrics: QQ prefers the dedicated IPC channel (avoids CORS), then falls back
  // to the provider. NetEase resolves entirely through its provider (IPC).
  const fetchLyrics = async (song: OnlineSong, provider: OnlineMusicProvider): Promise<string | undefined> => {
    const desktopAPI = getDesktopAPI();
    if (provider.id === 'qq' && desktopAPI?.getQQMusicLyrics) {
      const r = await desktopAPI.getQQMusicLyrics(song.songmid, provider.getRawCookie());
      if (r?.success && r.lyrics) return r.lyrics;
    }
    return (await provider.getLyrics(song.songmid)) || undefined;
  };

  // Fetch cover as a base64 data URL (via IPC to avoid CORS).
  const fetchCoverBase64 = async (coverUrl: string): Promise<string | undefined> => {
    if (!coverUrl) return undefined;
    const desktopAPI = getDesktopAPI();
    if (desktopAPI?.fetchCoverBase64) {
      const r = await desktopAPI.fetchCoverBase64(coverUrl);
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

  // Build a Track from a downloaded file: parse its metadata, save a cover
  // thumbnail, cache metadata, and return a Track ready for the local library.
  // Lifted from BrowseView.createTrackFromDownloadedFile so both flows share it.
  const buildDownloadedTrack = useCallback(async (
    filePath: string,
    fileName: string,
    song: OnlineSong,
    lyrics?: string,
  ): Promise<Track | null> => {
    try {
      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) return null;

      let metadata: {
        lyrics?: string;
        syncedLyrics?: { time: number; text: string }[];
        duration?: number;
        fileSize?: number;
      } | undefined;
      try {
        const parseResult = await desktopAPI.parseAudioMetadata(filePath);
        if (parseResult.success && parseResult.metadata) {
          metadata = parseResult.metadata as typeof metadata;
        }
      } catch (error) {
        logger.error('[OnlineMusic] Failed to parse metadata:', error);
      }

      const parsedLyrics = lyrics ? parseLRCLyrics(lyrics) : null;
      const finalLyrics = parsedLyrics?.plainText || metadata?.lyrics || lyrics || '';
      const finalSyncedLyrics = parsedLyrics?.syncedLyrics || metadata?.syncedLyrics;

      const trackId = Math.random().toString(36).substr(2, 9);
      const singer = song.singer?.map(s => s.name).join(' / ') || 'Unknown';

      const coverUrl = getOnlineProvider().getCoverUrl(song) || song.coverUrl
        || `https://picsum.photos/seed/${encodeURIComponent(fileName)}/1000/1000`;

      let finalCoverUrl = coverUrl;
      if (coverUrl && desktopAPI.saveCoverThumbnail) {
        try {
          const coverBase64 = await fetchCoverBase64(coverUrl);
          if (coverBase64) {
            const base64Data = coverBase64.split(',')[1] ?? '';
            const mimeMatch = coverBase64.match(/^data:(.*?);/);
            const mime = mimeMatch?.[1] ?? 'image/jpeg';
            const coverResult = await desktopAPI.saveCoverThumbnail({
              id: trackId, data: base64Data, mime,
            });
            if (coverResult?.success && coverResult.coverUrl) {
              finalCoverUrl = coverResult.coverUrl;
            }
          }
        } catch (error) {
          logger.warn('[OnlineMusic] Failed to save cover thumbnail:', error);
        }
      }

      metadataCacheService.set(trackId, {
        title: song.songname,
        artist: singer,
        album: song.albumname || '',
        duration: metadata?.duration || song.interval || 0,
        lyrics: finalLyrics,
        syncedLyrics: finalSyncedLyrics,
        fileName,
        fileSize: metadata?.fileSize || 0,
        lastModified: Date.now(),
      });

      return {
        id: trackId,
        title: song.songname,
        artist: singer,
        album: song.albumname || 'Unknown Album',
        duration: metadata?.duration || song.interval || 0,
        lyrics: finalLyrics,
        ...(finalSyncedLyrics ? { syncedLyrics: finalSyncedLyrics } : {}),
        coverUrl: finalCoverUrl,
        audioUrl: '',
        fileName,
        filePath,
        fileSize: metadata?.fileSize || 0,
        lastModified: Date.now(),
        addedAt: new Date().toISOString(),
        available: true,
      };
    } catch (error) {
      logger.error('[OnlineMusic] Failed to create track:', error);
      return null;
    }
  }, []);

  const handleOnlineDownload = useCallback(async (song: OnlineSong, quality: OnlineQuality) => {
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) { setViewMode(ViewMode.SETTINGS); return; }
    const provider = getOnlineProvider();
    const songId = song.songmid;
    activeSongRef.current = songId;
    setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 0 } }));
    try {
      const singer = song.singer?.map((s) => s.name).join(' & ') || 'Unknown';
      const ext = quality === 'flac' ? 'flac' : quality === 'm4a' ? 'm4a' : 'mp3';
      const fileName = buildSafeMusicFileName(singer, song.songname, ext);
      const cookie = provider.getRawCookie();
      const coverUrl = provider.getCoverUrl(song) || song.coverUrl;
      const [lyrics, { url }] = await Promise.all([
        fetchLyrics(song, provider),
        provider.getMusicUrl(song.songmid, quality),
      ]);
      const fullPath = joinDownloadPath(downloadPath, fileName);
      const desktopAPI = getDesktopAPI();
      const result = await desktopAPI?.downloadAndSave?.(url, cookie, fullPath);
      if (!result?.success || !result.filePath) throw new Error('Download failed');
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 80 } }));
      if (desktopAPI?.writeAudioMetadata) {
        await desktopAPI.writeAudioMetadata(result.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
          ...(lyrics != null && { lyrics }),
          ...(coverUrl != null && { coverUrl }),
        });
      }
      // Build a Track from the downloaded file and add it to the local library.
      if (onDownloadComplete) {
        const track = await buildDownloadedTrack(result.filePath, fileName, song, lyrics);
        if (track) onDownloadComplete(track);
      }
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 100, status: 'completed' } }));
      notify(t('notifications.downloadComplete'), song.songname, { silent: true });
      setTimeout(() => setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; }), 3000);
    } catch (err: unknown) {
      logger.error('[OnlineMusic] download failed:', err);
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 0, status: 'error' } }));
      notify(t('notifications.downloadFailed'), err instanceof Error ? err.message : '');
      setTimeout(() => setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; }), 5000);
    } finally {
      if (activeSongRef.current === songId) activeSongRef.current = null;
    }
  }, [setViewMode, onDownloadComplete, buildDownloadedTrack]);

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
      const ext = quality === 'flac' ? 'flac' : quality === 'm4a' ? 'm4a' : 'mp3';
      const fileName = buildSafeMusicFileName(singer, song.songname, ext);
      const cookie = provider.getRawCookie();
      const coverUrl = provider.getCoverUrl(song) || song.coverUrl;
      const [lyrics, { url }, coverBase64] = await Promise.all([
        fetchLyrics(song, provider),
        provider.getMusicUrl(song.songmid, quality),
        coverUrl ? fetchCoverBase64(coverUrl) : Promise.resolve(undefined),
      ]);
      const fullPath = joinDownloadPath(downloadPath, fileName);
      const desktopAPI = getDesktopAPI();
      const dlResult = await desktopAPI?.downloadAndSave?.(url, cookie, fullPath);
      if (!dlResult?.success || !dlResult.filePath) throw new Error('Download failed');
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 35 } }));
      if (desktopAPI?.writeAudioMetadata) {
        await desktopAPI.writeAudioMetadata(dlResult.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
          ...(lyrics != null && { lyrics }),
          ...(coverBase64 != null ? { coverUrl: coverBase64 } : coverUrl != null ? { coverUrl } : {}),
        });
      }
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 50 } }));
      const readResult = await desktopAPI?.readFile?.(dlResult.filePath);
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
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 100, status: 'completed' } }));
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
      notify(t('notifications.uploadComplete'), `${song.songname} → WebDAV`, { silent: true });
      setTimeout(() => setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; }), 3000);
    } catch (err: unknown) {
      logger.error('[OnlineMusic] upload failed:', err);
      setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; });
      notify(t('notifications.uploadFailed'), err instanceof Error ? err.message : '');
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
    const desktopAPI = getDesktopAPI();
    desktopAPI?.onDownloadProgress?.(handler);
    return () => { desktopAPI?.offDownloadProgress?.(handler); };
  }, []);

  return { onlineProgress, handleOnlineDownload, handleOnlineUpload };
}
