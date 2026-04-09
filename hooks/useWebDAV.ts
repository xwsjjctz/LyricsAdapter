import { useState, useCallback, useRef } from 'react';
import { Track } from '../types';
import { webdavClient, WebDAVFile } from '../services/webdavClient';
import { parseMetadataFromBuffer } from '../services/metadataService';
import { logger } from '../services/logger';

const METADATA_CACHE_KEY = 'webdav-metadata-cache';
const BATCH_SIZE = 5;
const RANGE_SIZE = 65536;

interface CachedMetadata {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
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

  const loadMetadataCache = (): Map<string, CachedMetadata> => {
    try {
      const saved = localStorage.getItem(METADATA_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, CachedMetadata>;
        return new Map(Object.entries(parsed));
      }
    } catch (e) {
      logger.error('[useWebDAV] Failed to load metadata cache:', e);
    }
    return new Map();
  };

  const saveMetadataCache = (cache: Map<string, CachedMetadata>) => {
    try {
      const obj = Object.fromEntries(cache);
      localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(obj));
    } catch (e) {
      logger.error('[useWebDAV] Failed to save metadata cache:', e);
    }
  };

  const isCacheValid = (cached: CachedMetadata, file: WebDAVFile): boolean => {
    return cached.fileSize === file.size && cached.lastModified === file.lastModified;
  };

  const fetchMetadata = async (file: WebDAVFile): Promise<CachedMetadata> => {
    const buffer = await webdavClient.fetchFileRange(file.path, 0, RANGE_SIZE);
    logger.info('[useWebDAV] fetchFileRange for', file.name, '→ buffer:', buffer ? `${buffer.byteLength} bytes` : 'null');
    if (!buffer) {
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
    const { artist, title } = parseArtistTitleFromFilename(file.name);

    return {
      title: parsed.title || title,
      artist: parsed.artist || artist,
      album: parsed.album || 'Unknown Album',
      coverUrl: parsed.coverUrl || '',
      duration: parsed.duration || 0,
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
  });

  const loadWebDAVFiles = useCallback(async () => {
    if (!webdavClient.hasConfig()) {
      setError('WebDAV not configured');
      return;
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
        return;
      }

      const placeholderTracks = audioFiles.map(fileToPlaceholderTrack);
      setWebdavTracks(placeholderTracks);

      const metadataCache = loadMetadataCache();
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
        setWebdavTracks([...placeholderTracks]);
        setIsLoading(false);
        setLoadProgress(null);
        return;
      }

      setLoadProgress({ loaded: audioFiles.length - toFetch.length, total: audioFiles.length });
      setWebdavTracks([...placeholderTracks]);

      let fetched = audioFiles.length - toFetch.length;

      for (let batch = 0; batch < toFetch.length; batch += BATCH_SIZE) {
        if (abortRef.current) return;

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
        saveMetadataCache(metadataCache);
      }

      setLoadProgress(null);
    } catch (e: any) {
      logger.error('[useWebDAV] Failed to load files:', e);
      setError(e.message || 'Failed to load WebDAV files');
    } finally {
      setIsLoading(false);
    }
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
  };
};
