import type { MetaJson, Track } from '../../types';
import type { WebDAVFile } from '../webdavClient';
import type { ChunkEntry, ManifestEntry } from './metadataFolderService';

/** Pure mapping between WebDAV listings, cached metadata and library tracks. */

export type WebDAVDiffResult =
  | { type: 'full'; tracks: Track[] }
  | { type: 'diff'; added: Track[]; removed: string[]; updated: Track[] }
  | { type: 'error'; error: string };

export interface CachedMetadata {
  title: string;
  artist: string;
  album: string;
  /** 封面 data URL（从文件头解析得到或从 chunk 拉取） */
  coverUrl?: string;
  duration: number;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  fileSize: number;
  lastModified: string;
  /** 详情所在 chunkId（恢复时记录，增量上传时保留分配） */
  chunkId?: string;
}

export type FileListSnapshot = Record<string, { size: number; lastModified: string }>;

export interface FileDiff {
  added: WebDAVFile[];
  removed: string[];
  changed: WebDAVFile[];
  unchanged: string[];
}

export function diffFileLists(
  remoteFiles: WebDAVFile[],
  snapshot: Map<string, { size: number; lastModified: string }>,
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

/** The listing fingerprint stored after a consistent load. */
export function buildFileListSnapshot(audioFiles: WebDAVFile[]): FileListSnapshot {
  const snapshot: FileListSnapshot = {};
  for (const file of audioFiles) {
    snapshot[file.path] = { size: file.size, lastModified: file.lastModified };
  }
  return snapshot;
}

/**
 * 从 Track 重建 WebDAVFile，供读取端治愈（lazyLoadCover 重新解析封面）使用。
 * track.lastModified 是 PROPFIND getlastmodified 解析出的 ms 数值，转回 ISO 字符串。
 */
export function trackToWebDAVFile(track: Track): WebDAVFile {
  return {
    name: track.fileName ?? '',
    path: track.webdavPath ?? '',
    size: track.fileSize ?? 0,
    lastModified: track.lastModified ? new Date(track.lastModified).toISOString() : '',
    isDirectory: false,
  };
}

/**
 * 从 (path, CachedMetadata) 重建 WebDAVFile，供上传端本机封面缺失时
 * 回退从 webdav 音频重新解析封面使用。meta.lastModified 已是 PROPFIND 字符串。
 */
export function metaToWebDAVFile(path: string, meta: { fileSize: number; lastModified: string }): WebDAVFile {
  return {
    name: path.split('/').pop() || '',
    path,
    size: meta.fileSize ?? 0,
    lastModified: meta.lastModified ?? '',
    isDirectory: false,
  };
}

export function isMetaJsonValid(meta: MetaJson, file: WebDAVFile): boolean {
  return meta.fileSize === file.size && meta.lastModified === file.lastModified;
}

export function isCacheValid(cached: CachedMetadata, file: WebDAVFile): boolean {
  return cached.fileSize === file.size && cached.lastModified === file.lastModified;
}

export function parseArtistTitleFromFilename(filename: string): { artist: string; title: string } {
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

/** 文件名降级兜底：从文件名解析 artist/title，返回 duration=0 的 CachedMetadata */
export function fallbackToFilename(file: WebDAVFile): CachedMetadata {
  const { artist, title } = parseArtistTitleFromFilename(file.name);
  return { artist, title, album: 'Unknown Album', duration: 0, fileSize: file.size, lastModified: file.lastModified };
}

export function fileToPlaceholderTrack(file: WebDAVFile): Track {
  const { artist, title } = parseArtistTitleFromFilename(file.name);
  // lastModified 取 PROPFIND 的 getlastmodified（上传时间），作为云端排序键；解析失败记 0（置顶）。
  const mtime = Date.parse(file.lastModified);
  return {
    id: `webdav-${file.path}`,
    title,
    artist,
    album: 'Unknown Album',
    duration: 0,
    coverUrl: '',
    audioUrl: '',
    source: 'webdav',
    webdavPath: file.path,
    fileName: file.name,
    fileSize: file.size,
    lastModified: Number.isFinite(mtime) ? mtime : 0,
  };
}

export function enrichTrack(track: Track, meta: CachedMetadata): Track {
  return {
    ...track,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration,
    coverUrl: meta.coverUrl ?? track.coverUrl,
    lyrics: meta.lyrics,
    syncedLyrics: meta.syncedLyrics,
  };
}

/** 从 manifest entry 丰富 track（无封面，列表展示用，秒出）。封面待 chunk 拉取后补。 */
export function enrichFromManifest(track: Track, entry: ManifestEntry): Track {
  return {
    ...track,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    duration: entry.duration,
  };
}

/** 从 chunk entry 补全封面/歌词。manifest entry 提供 chunkId 关联。 */
export function enrichFromChunk(track: Track, chunkEntry: ChunkEntry): Track {
  return {
    ...track,
    coverUrl: chunkEntry.coverUrl ?? track.coverUrl,
    lyrics: chunkEntry.lyrics ?? track.lyrics,
    syncedLyrics: chunkEntry.syncedLyrics ?? track.syncedLyrics,
  };
}
