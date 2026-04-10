import { useState, useCallback, useRef } from 'react';
import { Track } from '../types';
import { webdavClient, WebDAVFile } from '../services/webdavClient';
import { parseMetadataFromBuffer, parseCoverFromRange, parseVorbisComment } from '../services/metadataService';
import { logger } from '../services/logger';
import { indexedDBStorage } from '../services/indexedDBStorage';

const BATCH_SIZE = 10;
const RANGE_SIZE = 1048576;

async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  if (!blobUrl || !blobUrl.startsWith('blob:')) return blobUrl;
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(blobUrl);
      reader.readAsDataURL(blob);
    });
  } catch {
    return blobUrl;
  }
}

interface CachedMetadata {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  fileSize: number;
  lastModified: string;
}

function parseArtistTitleFromFilename(filename: string): { artist: string; title: string } {
  const name = filename.replace(/\.[^/.]+$/, '');
  const patterns = [
    /^(.+?)\s*[-–—]\s*(.+)$/,
    /^(.+?)\s*_\s*(.+)$/,
  ];
  for (const p of patterns) {
    const match = name.match(p);
    if (match) {
      return { artist: match[1].trim(), title: match[2].trim() };
    }
  }
  return { artist: 'Unknown Artist', title: name };
}

function fileToPlaceholderTrack(file: WebDAVFile): Track {
  const { artist, title } = parseArtistTitleFromFilename(file.name);
  return {
    id: `webdav-${file.path}`,
    title,
    artist,
    album: 'Unknown Album',
    duration: 0,
    coverUrl: `https://picsum.photos/seed/${encodeURIComponent(file.name)}/1000/1000`,
    audioUrl: '',
    source: 'webdav',
    webdavPath: file.path,
    fileName: file.name,
    fileSize: file.size,
  };
}

export const useWebDAV = () => {
  const [webdavTracks, setWebdavTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const abortRef = useRef(false);

  const loadMetadataCache = async (): Promise<Map<string, CachedMetadata>> => {
    try {
      await indexedDBStorage.initialize();
      const entries = await indexedDBStorage.getAllWebdavMetadata();
      return new Map(Object.entries(entries));
    } catch (e) {
      logger.error('[useWebDAV] Failed to load metadata cache from IndexedDB:', e);
      return new Map();
    }
  };

  const saveMetadataCache = async (cache: Map<string, CachedMetadata>) => {
    try {
      await indexedDBStorage.initialize();
      for (const [key, value] of cache) {
        await indexedDBStorage.setWebdavMetadata(key, value);
      }
    } catch (e) {
      logger.error('[useWebDAV] Failed to save metadata cache to IndexedDB:', e);
    }
  };

  const isCacheValid = (cached: CachedMetadata, file: WebDAVFile): boolean => {
    return cached.fileSize === file.size && cached.lastModified === file.lastModified;
  };

  const fetchMetadata = async (file: WebDAVFile): Promise<CachedMetadata> => {
    const buffer = await webdavClient.fetchFileRange(file.path, 0, RANGE_SIZE);
    logger.info('[useWebDAV] fetchFileRange for', file.name, '→ buffer:', buffer ? `${buffer.byteLength} bytes` : 'null');
    if (!buffer) {
      logger.warn('[useWebDAV] fetchFileRange returned null for', file.name, '- falling back to filename');
      return {
        ...parseArtistTitleFromFilename(file.name),
        album: 'Unknown Album',
        coverUrl: '',
        duration: 0,
        fileSize: file.size,
        lastModified: file.lastModified,
      };
    }

    const parsed = parseMetadataFromBuffer(buffer, file.name);
    logger.info('[useWebDAV] parseMetadataFromBuffer for', file.name, '→ album:', parsed.album, 'lyrics:', parsed.lyrics ? 'found' : 'none', 'vcTruncated:', !!parsed.vorbisCommentNeededRange);
    const { artist, title } = parseArtistTitleFromFilename(file.name);

    if (parsed.vorbisCommentNeededRange) {
      const { offset: vcOffset, length: vcLength } = parsed.vorbisCommentNeededRange;
      logger.info('[useWebDAV] VORBIS_COMMENT truncated, fetching range:', vcOffset, '-', vcOffset + vcLength);
      const vcBuffer = await webdavClient.fetchFileRange(file.path, vcOffset, vcOffset + vcLength);
      if (vcBuffer) {
        logger.info('[useWebDAV] VORBIS_COMMENT refetch got', vcBuffer.byteLength, 'bytes');
        const vcResult = parseVorbisComment(vcBuffer);
        if (vcResult.title) parsed.title = vcResult.title;
        if (vcResult.artist) parsed.artist = vcResult.artist;
        if (vcResult.album) parsed.album = vcResult.album;
        if (vcResult.lyrics) parsed.lyrics = vcResult.lyrics;
        if (vcResult.syncedLyrics) parsed.syncedLyrics = vcResult.syncedLyrics;
        logger.info('[useWebDAV] After VORBIS_COMMENT refetch:', parsed.album, parsed.lyrics ? 'lyrics found' : 'no lyrics');
      } else {
        logger.warn('[useWebDAV] VORBIS_COMMENT refetch returned null for', file.name);
      }
    }

    let coverUrl = parsed.coverUrl || '';
    if (!coverUrl && parsed.coverNeededRange) {
      const { offset: coverOffset, length: coverLength } = parsed.coverNeededRange;
      logger.info('[useWebDAV] Cover truncated, fetching range:', coverOffset, '-', coverOffset + coverLength);
      const coverBuffer = await webdavClient.fetchFileRange(file.path, coverOffset, coverOffset + coverLength);
      if (coverBuffer) {
        coverUrl = parseCoverFromRange(coverBuffer, file.name, coverOffset);
      }
    }

    return {
      title: parsed.title || title,
      artist: parsed.artist || artist,
      album: parsed.album || 'Unknown Album',
      coverUrl: await blobUrlToDataUrl(coverUrl),
      duration: parsed.duration || 0,
      lyrics: parsed.lyrics,
      syncedLyrics: parsed.syncedLyrics,
      fileSize: file.size,
      lastModified: file.lastModified,
    };
  };

  const enrichTrack = (track: Track, meta: CachedMetadata): Track => ({
    ...track,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration,
    coverUrl: meta.coverUrl || track.coverUrl,
    lyrics: meta.lyrics,
    syncedLyrics: meta.syncedLyrics,
  });

  const loadWebDAVFiles = useCallback(async (): Promise<Track[]> => {
    if (!webdavClient.hasConfig()) {
      setError('WebDAV not configured');
      return [];
    }

    abortRef.current = false;
    setIsLoading(true);
    setError(null);

    try {
      const files = await webdavClient.listFiles('/');
      const audioFiles = files.filter(f => !f.isDirectory);

      if (audioFiles.length === 0) {
        setWebdavTracks([]);
        setIsLoading(false);
        return [];
      }

      const placeholderTracks = audioFiles.map(fileToPlaceholderTrack);
      setWebdavTracks(placeholderTracks);

      const metadataCache = await loadMetadataCache();
      const toFetch: { file: WebDAVFile; index: number }[] = [];

      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const cached = metadataCache.get(file.path);
        if (cached && isCacheValid(cached, file)) {
          placeholderTracks[i] = enrichTrack(placeholderTracks[i], cached);
        } else {
          toFetch.push({ file, index: i });
        }
      }

      if (toFetch.length === 0) {
        const finalTracks = [...placeholderTracks];
        setWebdavTracks(finalTracks);
        setIsLoading(false);
        setLoadProgress(null);
        return finalTracks;
      }

      setLoadProgress({ loaded: audioFiles.length - toFetch.length, total: audioFiles.length });
      setWebdavTracks([...placeholderTracks]);

      let fetched = audioFiles.length - toFetch.length;

      for (let batch = 0; batch < toFetch.length; batch += BATCH_SIZE) {
        if (abortRef.current) return [];

        const batchItems = toFetch.slice(batch, batch + BATCH_SIZE);
        const results = await Promise.allSettled(
          batchItems.map(async ({ file, index }) => {
            const meta = await fetchMetadata(file);
            metadataCache.set(file.path, meta);
            return { index, meta };
          })
        );

        fetched += batchItems.length;
        setLoadProgress({ loaded: Math.min(fetched, audioFiles.length), total: audioFiles.length });

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { index, meta } = result.value;
            placeholderTracks[index] = enrichTrack(placeholderTracks[index], meta);
          }
        }

        setWebdavTracks([...placeholderTracks]);
      }

      await saveMetadataCache(metadataCache);

      setLoadProgress(null);
      const finalTracks = [...placeholderTracks];
      setWebdavTracks(finalTracks);
      return finalTracks;
    } catch (e: any) {
      logger.error('[useWebDAV] Failed to load files:', e);
      setError(e.message || 'Failed to load WebDAV files');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearWebdavCache = useCallback(async () => {
    try {
      await indexedDBStorage.initialize();
      await indexedDBStorage.clearWebdavMetadata();
    } catch (e) {
      logger.warn('[useWebDAV] Failed to clear IndexedDB cache:', e);
    }
    webdavClient.clearCdnCache();
    setWebdavTracks([]);
    logger.info('[useWebDAV] Cache cleared');
  }, []);

  const forceReload = useCallback(() => {
    setWebdavTracks([]);
    setIsLoading(false);
    setError(null);
    setLoadProgress(null);
  }, []);

  const cancelLoad = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    webdavTracks,
    isLoading,
    error,
    loadProgress,
    loadWebDAVFiles,
    cancelLoad,
    clearWebdavCache,
    forceReload,
  };
};
