import { useState, useCallback } from 'react';
import { Track, SyncedLyricLine } from '../types';
import { webdavClient, WebDAVFile } from '../services/webdavClient';
import { parseMetadataFromBuffer } from '../services/metadataService';
import { logger } from '../services/logger';

const METADATA_CACHE_KEY = 'webdav-metadata-cache';
const METADATA_CACHE_TTL = 24 * 60 * 60 * 1000;

interface CachedMetadata {
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  cachedAt: number;
}

export const useWebDAV = () => {
  const [webdavTracks, setWebdavTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMetadataCache = (): Map<string, CachedMetadata> => {
    try {
      const saved = localStorage.getItem(METADATA_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, CachedMetadata>;
        const map = new Map<string, CachedMetadata>();
        const now = Date.now();
        for (const [key, value] of Object.entries(parsed)) {
          if (now - value.cachedAt < METADATA_CACHE_TTL) {
            map.set(key, value);
          }
        }
        return map;
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

  const parseRemoteMetadata = async (file: WebDAVFile): Promise<CachedMetadata> => {
    const buffer = await webdavClient.fetchFileRange(file.path, 0, 65536);
    if (!buffer) {
      return {
        title: file.name.replace(/\.[^/.]+$/, ''),
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        coverUrl: '',
        duration: 0,
        cachedAt: Date.now()
      };
    }

    const parsed = parseMetadataFromBuffer(buffer, file.name);

    return {
      title: parsed.title || file.name.replace(/\.[^/.]+$/, ''),
      artist: parsed.artist || 'Unknown Artist',
      album: parsed.album || 'Unknown Album',
      coverUrl: parsed.coverUrl || '',
      duration: parsed.duration || 0,
      cachedAt: Date.now()
    };
  };

  const loadWebDAVFiles = useCallback(async () => {
    if (!webdavClient.hasConfig()) {
      setError('WebDAV not configured');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const files = await webdavClient.listFiles('/');
      const audioFiles = files.filter(f => !f.isDirectory);
      const metadataCache = loadMetadataCache();
      const tracks: Track[] = [];

      for (const file of audioFiles) {
        let metadata = metadataCache.get(file.path);

        if (!metadata) {
          try {
            metadata = await parseRemoteMetadata(file);
            metadataCache.set(file.path, metadata);
          } catch (e) {
            logger.warn('[useWebDAV] Failed to parse metadata for', file.name, e);
            metadata = {
              title: file.name.replace(/\.[^/.]+$/, ''),
              artist: 'Unknown Artist',
              album: 'Unknown Album',
              coverUrl: '',
              duration: 0,
              cachedAt: Date.now()
            };
          }
        }

        tracks.push({
          id: `webdav-${file.path}`,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          duration: metadata.duration,
          coverUrl: metadata.coverUrl || `https://picsum.photos/seed/${encodeURIComponent(file.name)}/1000/1000`,
          audioUrl: '',
          source: 'webdav',
          webdavPath: file.path,
          fileName: file.name,
          fileSize: file.size,
        });
      }

      saveMetadataCache(metadataCache);
      setWebdavTracks(tracks);
    } catch (e: any) {
      logger.error('[useWebDAV] Failed to load files:', e);
      setError(e.message || 'Failed to load WebDAV files');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    webdavTracks,
    isLoading,
    error,
    loadWebDAVFiles,
  };
};
