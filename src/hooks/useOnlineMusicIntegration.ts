import { useState, useCallback, useRef, useEffect } from 'react';
import { Track } from '../types';
import type { SettingsSectionId } from '../components/settings/SettingsView';
import {
  getOnlineProvider,
  type OnlineMusicProvider,
  type OnlineLyricsResult,
  type OnlineQuality,
  type OnlineSong,
  type OnlineSource,
} from '../services/onlineMusicProvider';
import { settingsManager } from '../services/settingsManager';
import { webdavClient } from '../services/webdavClient';
import { generateMetaJson } from '../services/webdavMetaService';
import { notify } from '../services/notificationService';
import { parseLyrics } from '../services/metadataService';
import { metadataCacheService } from '../services/metadataCacheService';
import { logger } from '../services/logger';
import { useTranslation } from 'react-i18next';
import { QUALITY_EXTENSION, QUALITY_LABEL, saveOnlineAudio } from '../services/onlineDownload';
import { getDesktopAPI, getDesktopAPIAsync } from '../services/desktopAdapter';
import { WEBDAV_AUDIO_UPLOAD_ENABLED } from '../constants/features';
import type { DownloadProgressEvent, OnlineProgressEntry } from '../types/onlineProgress';

interface UseOnlineMusicIntegrationParams {
  /** Opens the settings sheet when a download/upload lacks configuration. */
  openSettings: (section: SettingsSectionId) => void;
  mergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
  /** Invoked after a download completes and the track is built (adds to local library). */
  onDownloadComplete?: (track: Track) => void;
}

/**
 * Online music integration: download to local
 * disk or upload to WebDAV, for whichever source is active in settings.
 *
 * Source-agnostic: every call resolves the active provider fresh, so switching
 * the online source in settings takes effect immediately.
 */
export function useOnlineMusicIntegration({ openSettings, mergeCloudTracks, onDownloadComplete }: UseOnlineMusicIntegrationParams) {
  const [onlineProgress, setOnlineProgress] = useState<Record<string, OnlineProgressEntry>>({});
  const requests = useRef(new Map<string, { key: string; type: 'download' | 'upload' }>());
  const expiryTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const { t } = useTranslation();

  const showDownloadOutcome = useCallback((key: string, entry: OnlineProgressEntry, delay: number) => {
    setOnlineProgress(prev => ({ ...prev, [key]: entry }));
    const timer = setTimeout(() => {
      expiryTimers.current.delete(timer);
      setOnlineProgress(prev => {
        // A retry may already be running when the previous outcome expires.
        if (prev[key] !== entry) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, delay);
    expiryTimers.current.add(timer);
  }, []);

  useEffect(() => () => {
    for (const timer of expiryTimers.current) clearTimeout(timer);
  }, []);

  // Every source goes through its provider so playback and download/upload
  // share bounded caching and in-flight request deduplication.
  const fetchLyrics = async (song: OnlineSong, provider: OnlineMusicProvider): Promise<OnlineLyricsResult | undefined> => {
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
    lyrics?: OnlineLyricsResult,
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

      const parsedLyrics = lyrics ? parseLyrics(lyrics.lyrics, lyrics.wordLyrics, lyrics.wordLyricsFormat) : null;
      const finalLyrics = parsedLyrics?.plainText || metadata?.lyrics || lyrics?.lyrics || '';
      const finalSyncedLyrics = parsedLyrics?.syncedLyrics || metadata?.syncedLyrics;

      const trackId = Math.random().toString(36).substr(2, 9);
      const singer = song.singer?.map(s => s.name).join(' / ') || 'Unknown';

      const coverUrl = getOnlineProvider().getCoverUrl(song) || song.coverUrl || '';

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

  const handleOnlineDownload = useCallback(async (
    song: OnlineSong,
    quality: OnlineQuality,
    source?: OnlineSource,
  ) => {
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) { openSettings('online'); return; }
    // Playlist and queue tracks carry their own source; search results use the active one.
    const provider = getOnlineProvider(source);
    // Same identity as onlineSongToTrack, including the provider.
    const songId = `online-${provider.id}-${song.songmid}`;
    if ([...requests.current.values()].some(task => task.key === songId)) return;
    const requestId = crypto.randomUUID();
    requests.current.set(requestId, { key: songId, type: 'download' });
    setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 0, phase: 'preparing' } }));
    try {
      const singer = song.singer?.map((s) => s.name).join(' & ') || 'Unknown';
      const coverUrl = provider.getCoverUrl(song) || song.coverUrl;
      const desktopAPI = getDesktopAPI();
      const [lyrics, saved] = await Promise.all([
        fetchLyrics(song, provider),
        saveOnlineAudio({
          provider, song, quality, singer, downloadPath,
          save: desktopAPI?.downloadAndSave
            ? (url, cookie, filePath) => desktopAPI.downloadAndSave!(url, cookie, filePath, requestId)
            : undefined,
        }),
      ]);
      const { fileName } = saved;
      const result = { filePath: saved.filePath };
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'download', percent: 100, phase: 'saving' } }));
      if (desktopAPI?.writeAudioMetadata) {
        await desktopAPI.writeAudioMetadata(result.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
          ...(lyrics != null && { lyrics: lyrics.lyrics }),
          ...(lyrics?.wordLyrics != null && { wordLyrics: lyrics.wordLyrics, wordLyricsFormat: lyrics.wordLyricsFormat }),
          ...(coverUrl != null && { coverUrl }),
        });
      }
      // Build a Track so the notification can use its persisted cover even when
      // no library callback was supplied.
      const downloadedTrack = await buildDownloadedTrack(result.filePath, fileName, song, lyrics);
      if (downloadedTrack && onDownloadComplete) onDownloadComplete(downloadedTrack);
      const doneMessage = saved.served === quality
        ? t('notifications.trackDownloadSuccess', { artist: singer, title: song.songname })
        : t('notifications.trackDownloadDowngraded', {
          artist: singer, title: song.songname,
          requested: QUALITY_LABEL[quality], served: QUALITY_LABEL[saved.served],
        });
      showDownloadOutcome(songId, { type: 'download', percent: 100, status: 'completed', message: doneMessage }, 3000);
      notify(
        t('notifications.downloadComplete'),
        doneMessage,
        {
          silent: true,
          artworkUrls: [downloadedTrack?.coverUrl || coverUrl].filter((url): url is string => Boolean(url)),
        },
      );
    } catch (err: unknown) {
      logger.error('[OnlineMusic] download failed:', err);
      const reason = err instanceof Error ? err.message : '';
      showDownloadOutcome(songId, { type: 'download', percent: 0, status: 'error', message: reason }, 5000);
      notify(t('notifications.downloadFailed'), reason);
    } finally {
      requests.current.delete(requestId);
    }
  }, [openSettings, onDownloadComplete, buildDownloadedTrack, showDownloadOutcome]);

  const handleOnlineUpload = useCallback(async (song: OnlineSong, quality: OnlineQuality) => {
    if (!WEBDAV_AUDIO_UPLOAD_ENABLED) return;
    if (!webdavClient.hasConfig()) { openSettings('cloud'); return; }
    const downloadPath = settingsManager.getDownloadPath();
    if (!downloadPath) { openSettings('online'); return; }
    const provider = getOnlineProvider();
    const songId = `upload-${provider.id}-${song.songmid}`;
    const requestId = crypto.randomUUID();
    requests.current.set(requestId, { key: songId, type: 'upload' });
    setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 0 } }));
    try {
      const singer = song.singer?.map((s) => s.name).join(' & ') || 'Unknown';
      const coverUrl = provider.getCoverUrl(song) || song.coverUrl;
      const desktopAPI = getDesktopAPI();
      const [lyrics, saved, coverBase64] = await Promise.all([
        fetchLyrics(song, provider),
        saveOnlineAudio({
          provider, song, quality, singer, downloadPath,
          save: desktopAPI?.downloadAndSave
            ? (url, cookie, filePath) => desktopAPI.downloadAndSave!(url, cookie, filePath, requestId)
            : undefined,
        }),
        coverUrl ? fetchCoverBase64(coverUrl) : Promise.resolve(undefined),
      ]);
      const { fileName } = saved;
      const dlResult = { filePath: saved.filePath };
      const parsedLyrics = lyrics
        ? parseLyrics(lyrics.lyrics, lyrics.wordLyrics, lyrics.wordLyricsFormat)
        : undefined;
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 35 } }));
      if (desktopAPI?.writeAudioMetadata) {
        await desktopAPI.writeAudioMetadata(dlResult.filePath, {
          title: song.songname, artist: singer, album: song.albumname || '',
          ...(lyrics != null && { lyrics: parsedLyrics?.plainText || lyrics.lyrics }),
          ...(lyrics?.wordLyrics != null && { wordLyrics: lyrics.wordLyrics, wordLyricsFormat: lyrics.wordLyricsFormat }),
          ...(coverBase64 != null ? { coverUrl: coverBase64 } : coverUrl != null ? { coverUrl } : {}),
        });
      }
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 50 } }));
      const readResult = await desktopAPI?.readFile?.(dlResult.filePath);
      if (!readResult?.success || !readResult.data) throw new Error('Failed to read file for upload');
      const webdavPath = `/${fileName}`;
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 65 } }));
      await webdavClient.uploadFile(webdavPath, readResult.data, `audio/${QUALITY_EXTENSION[saved.served]}`);
      setOnlineProgress((prev) => ({ ...prev, [songId]: { type: 'upload', percent: 85 } }));
      await webdavClient.uploadMetaJson(webdavPath, generateMetaJson({
        id: `webdav-${webdavPath}`, title: song.songname, artist: singer,
        album: song.albumname || '', duration: song.interval || 0, audioUrl: '',
        source: 'webdav', webdavPath, fileName, fileSize: readResult.data.byteLength,
        ...(lyrics != null && { lyrics: parsedLyrics?.plainText || lyrics.lyrics }),
        ...(parsedLyrics?.syncedLyrics != null && { syncedLyrics: parsedLyrics.syncedLyrics }),
        ...(lyrics?.wordLyrics != null && { wordLyrics: lyrics.wordLyrics, wordLyricsFormat: lyrics.wordLyricsFormat }),
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
        ...(lyrics != null && { lyrics: parsedLyrics?.plainText || lyrics.lyrics }),
        ...(parsedLyrics?.syncedLyrics != null && { syncedLyrics: parsedLyrics.syncedLyrics }),
        ...(lyrics?.wordLyrics != null && { wordLyrics: lyrics.wordLyrics, wordLyricsFormat: lyrics.wordLyricsFormat }),
        ...(coverBase64 != null ? { coverUrl: coverBase64 } : coverUrl != null ? { coverUrl } : {}),
      };
      mergeCloudTracks([cloudTrack], [], []);
      notify(t('notifications.uploadComplete'), `${song.songname} → WebDAV`, {
        silent: true,
        artworkUrls: [coverBase64 || coverUrl].filter((url): url is string => Boolean(url)),
      });
      setTimeout(() => setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; }), 3000);
    } catch (err: unknown) {
      logger.error('[OnlineMusic] upload failed:', err);
      setOnlineProgress((prev) => { const n = { ...prev }; delete n[songId]; return n; });
      notify(t('notifications.uploadFailed'), err instanceof Error ? err.message : '');
    } finally {
      requests.current.delete(requestId);
    }
  }, [openSettings, mergeCloudTracks]);

  // Download progress listener (forwarded from main process).
  useEffect(() => {
    const handler = (data: DownloadProgressEvent) => {
      const task = data.requestId ? requests.current.get(data.requestId) : undefined;
      if (!task || !Number.isFinite(data.progress)) return;
      setOnlineProgress(prev => {
        const current = prev[task.key];
        if (!current || current.status || current.phase === 'saving') return prev;
        const percent = Math.max(0, Math.min(100, Math.round(data.progress)));
        if (current.percent === percent && current.phase === 'downloading') return prev;
        return { ...prev, [task.key]: { ...current, percent, phase: 'downloading' } };
      });
    };
    const desktopAPI = getDesktopAPI();
    desktopAPI?.onDownloadProgress?.(handler);
    return () => { desktopAPI?.offDownloadProgress?.(handler); };
  }, []);

  return { onlineProgress, handleOnlineDownload, handleOnlineUpload };
}
