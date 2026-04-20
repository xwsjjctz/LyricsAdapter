import { useState, useCallback, useRef } from 'react';
import { Track } from '../types';
import { webdavClient, WebDAVFile } from '../services/webdavClient';
import { parseMetadataFromBuffer, parseCoverFromRange, parseVorbisComment } from '../services/metadataService';
import { logger } from '../services/logger';
import { indexedDBStorage } from '../services/indexedDBStorage';

const BATCH_SIZE = 10;
const RANGE_SIZE = 1048576;

export type WebDAVDiffResult =
  | { type: 'full'; tracks: Track[] }
  | { type: 'diff'; added: Track[]; removed: string[]; updated: Track[] };

interface FileDiff {
  added: WebDAVFile[];
  removed: string[];
  changed: WebDAVFile[];
  unchanged: string[];
}

function diffFileLists(
  remoteFiles: WebDAVFile[],
  snapshot: Map<string, { size: number; lastModified: string }>
): FileDiff {
  const remotePaths = new Set(remoteFiles.map(f => f.path));
  const added: WebDAVFile[] = [];
  const removed: string[] = [];
  const changed: WebDAVFile[] = [];
  const unchanged: string[] = [];

  for (const file of remoteFiles) {
    const snap = snapshot.get(file.path);
    if (!snap) {
      added.push(file);
    } else if (snap.size !== file.size || snap.lastModified !== file.lastModified) {
      changed.push(file);
    } else {
      unchanged.push(file.path);
    }
  }

  for (const [path] of snapshot) {
    if (!remotePaths.has(path)) {
      removed.push(path);
    }
  }

  return { added, removed, changed, unchanged };
}

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
      return { artist: match[1]!.trim(), title: match[2]!.trim() };
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
      ...(parsed.lyrics !== undefined && { lyrics: parsed.lyrics }),
      ...(parsed.syncedLyrics !== undefined && { syncedLyrics: parsed.syncedLyrics }),
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

  const loadWebDAVFiles = useCallback(async (): Promise<WebDAVDiffResult> => {
    if (!webdavClient.hasConfig()) {
      setError('WebDAV not configured');
      return { type: 'full', tracks: [] };
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
        await indexedDBStorage.setFileListSnapshot({});
        return { type: 'full', tracks: [] };
      }

      const snapshotRaw = await indexedDBStorage.getFileListSnapshot();
      const currentTracks = webdavTracks;

      if (!snapshotRaw || currentTracks.length === 0) {
        return await loadFullMode(audioFiles);
      }

      const snapshot = new Map(Object.entries(snapshotRaw));
      const diff = diffFileLists(audioFiles, snapshot);

      logger.info('[useWebDAV] Diff result: added=' + diff.added.length + ' removed=' + diff.removed.length + ' changed=' + diff.changed.length + ' unchanged=' + diff.unchanged.length);

      if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
        setIsLoading(false);
        const newSnapshot: Record<string, { size: number; lastModified: string }> = {};
        for (const file of audioFiles) {
          newSnapshot[file.path] = { size: file.size, lastModified: file.lastModified };
        }
        await indexedDBStorage.setFileListSnapshot(newSnapshot);
        return { type: 'diff', added: [], removed: [], updated: [] };
      }

      const filesToFetch: WebDAVFile[] = [...diff.added, ...diff.changed];
      const newPlaceholderMap = new Map<string, Track>();
      for (const file of filesToFetch) {
        newPlaceholderMap.set(file.path, fileToPlaceholderTrack(file));
      }

      const metadataCache = await loadMetadataCache();
      const toFetch: WebDAVFile[] = [];
      const enrichedNewTracks: Track[] = [];

      for (const file of filesToFetch) {
        const cached = metadataCache.get(file.path);
        const placeholder = newPlaceholderMap.get(file.path)!;
        if (cached && isCacheValid(cached, file)) {
          const enriched = enrichTrack(placeholder, cached);
          enrichedNewTracks.push(enriched);
        } else {
          toFetch.push(file);
        }
      }

      const removedIds = diff.removed.map(path => `webdav-${path}`);

      if (toFetch.length === 0) {
        setLoadProgress(null);
        setIsLoading(false);
        const updatedTracks = enrichedNewTracks.filter(t => diff.changed.some(f => f.path === (t.webdavPath || '')));
        const addedTracks = enrichedNewTracks.filter(t => diff.added.some(f => f.path === (t.webdavPath || '')));
        const newSnapshot: Record<string, { size: number; lastModified: string }> = {};
        for (const file of audioFiles) {
          newSnapshot[file.path] = { size: file.size, lastModified: file.lastModified };
        }
        await indexedDBStorage.setFileListSnapshot(newSnapshot);
        return { type: 'diff', added: addedTracks, removed: removedIds, updated: updatedTracks };
      }

      setLoadProgress({ loaded: enrichedNewTracks.length, total: filesToFetch.length });

      let fetched = enrichedNewTracks.length;

      for (let batch = 0; batch < toFetch.length; batch += BATCH_SIZE) {
        if (abortRef.current) return { type: 'full', tracks: [] };

        const batchItems = toFetch.slice(batch, batch + BATCH_SIZE);
        const results = await Promise.allSettled(
          batchItems.map(async (file) => {
            const meta = await fetchMetadata(file);
            metadataCache.set(file.path, meta);
            return { file, meta };
          })
        );

        fetched += batchItems.length;
        setLoadProgress({ loaded: Math.min(fetched, filesToFetch.length), total: filesToFetch.length });

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { file, meta } = result.value;
            const placeholder = newPlaceholderMap.get(file.path)!;
            const enriched = enrichTrack(placeholder, meta);
            enrichedNewTracks.push(enriched);
          }
        }
      }

      await saveMetadataCache(metadataCache);

      const newSnapshot: Record<string, { size: number; lastModified: string }> = {};
      for (const file of audioFiles) {
        newSnapshot[file.path] = { size: file.size, lastModified: file.lastModified };
      }
      await indexedDBStorage.setFileListSnapshot(newSnapshot);

      setLoadProgress(null);
      setIsLoading(false);

      const updatedTracks = enrichedNewTracks.filter(t => diff.changed.some(f => f.path === (t.webdavPath || '')));
      const addedTracks = enrichedNewTracks.filter(t => diff.added.some(f => f.path === (t.webdavPath || '')));
      return { type: 'diff', added: addedTracks, removed: removedIds, updated: updatedTracks };
    } catch (e: any) {
      logger.error('[useWebDAV] Failed to load files:', e);
      setError(e.message || 'Failed to load WebDAV files');
      return { type: 'full', tracks: [] };
    } finally {
      setIsLoading(false);
    }
  }, [webdavTracks]);

  const loadFullMode = async (audioFiles: WebDAVFile[]): Promise<WebDAVDiffResult> => {
    const placeholderTracks = audioFiles.map(fileToPlaceholderTrack);
    setWebdavTracks(placeholderTracks);

    const metadataCache = await loadMetadataCache();
    const toFetch: { file: WebDAVFile; index: number }[] = [];

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      if (!file) continue;
      const cached = metadataCache.get(file.path);
      if (cached && isCacheValid(cached, file)) {
        placeholderTracks[i] = enrichTrack(placeholderTracks[i]!, cached);
      } else {
        toFetch.push({ file, index: i });
      }
    }

    if (toFetch.length === 0) {
      const finalTracks = [...placeholderTracks];
      setWebdavTracks(finalTracks);
      setIsLoading(false);
      setLoadProgress(null);
      const snapshot: Record<string, { size: number; lastModified: string }> = {};
      for (const file of audioFiles) {
        snapshot[file.path] = { size: file.size, lastModified: file.lastModified };
      }
      await indexedDBStorage.setFileListSnapshot(snapshot);
      return { type: 'full', tracks: finalTracks };
    }

    setLoadProgress({ loaded: audioFiles.length - toFetch.length, total: audioFiles.length });
    setWebdavTracks([...placeholderTracks]);

    let fetched = audioFiles.length - toFetch.length;

    for (let batch = 0; batch < toFetch.length; batch += BATCH_SIZE) {
      if (abortRef.current) return { type: 'full', tracks: [] };

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
          placeholderTracks[index] = enrichTrack(placeholderTracks[index]!, meta);
        }
      }

      setWebdavTracks([...placeholderTracks]);
    }

    await saveMetadataCache(metadataCache);

    const snapshot: Record<string, { size: number; lastModified: string }> = {};
    for (const file of audioFiles) {
      snapshot[file.path] = { size: file.size, lastModified: file.lastModified };
    }
    await indexedDBStorage.setFileListSnapshot(snapshot);

    setLoadProgress(null);
    const finalTracks = [...placeholderTracks];
    setWebdavTracks(finalTracks);
    return { type: 'full', tracks: finalTracks };
  };

  const clearWebdavCache = useCallback(async () => {
    try {
      await indexedDBStorage.initialize();
      await indexedDBStorage.clearWebdavMetadata();
      await indexedDBStorage.clearFileListSnapshot();
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
