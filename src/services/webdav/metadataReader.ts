import { indexedDBStorage } from '../indexedDBStorage';
import { logger } from '../logger';
import { parseCoverFromRange, parseMetadataFromBuffer, parseVorbisComment } from '../metadataService';
import { webdavClient, type WebDAVFile } from '../webdavClient';
import { blobUrlToDataUrl, storeCoverLocally } from './coverStore';
import type { getEffectiveConfig } from './providerConfig';
import {
  fallbackToFilename,
  isMetaJsonValid,
  parseArtistTitleFromFilename,
  type CachedMetadata,
} from './trackMapping';

type WebDAVProvider = ReturnType<typeof getEffectiveConfig>;

/** Bytes read from the start of an audio file to parse its tags. */
const RANGE_SIZE = 1048576;
const HEADER_RETRIES = 2;

/** Reads tags, lyrics and covers from WebDAV audio files using the provider's read strategy. */
export interface WebDAVMetadataReader {
  /** Sidecar meta.json first, then the audio header; falls back to the file name. */
  readMetadata(file: WebDAVFile): Promise<CachedMetadata>;
  /** Backfills a missing cover from the audio header and caches it as data:. */
  readCover(file: WebDAVFile): Promise<string | undefined>;
}

export function createMetadataReader(provider: WebDAVProvider): WebDAVMetadataReader {
  /** 带重试的文件头读取（网络抖动时自动重试，最多 2 次） */
  const fetchRange = async (file: WebDAVFile, offset: number, length: number): Promise<ArrayBuffer | null> => {
    for (let attempt = 0; attempt <= HEADER_RETRIES; attempt++) {
      try {
        const buffer = provider.useDirectHeaderRead()
          ? await webdavClient.fetchFileRangeDirect(file.path, offset, offset + length)
          : await webdavClient.fetchFileRange(file.path, offset, offset + length);
        if (buffer) return buffer;
      } catch (err) {
        logger.warn(`[WebDAVReader] Header fetch failed for ${file.name} (attempt ${attempt + 1}/${HEADER_RETRIES + 1}):`, err);
      }
      if (attempt < HEADER_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    return null;
  };

  const readSidecar = async (file: WebDAVFile): Promise<CachedMetadata | null> => {
    if (!provider.autoUploadMetaJson()) return null;
    const sidecarMeta = await webdavClient.fetchMetaJson(file.path);
    if (!sidecarMeta || !isMetaJsonValid(sidecarMeta, file) || sidecarMeta.duration <= 0) return null;
    logger.info('[WebDAVReader] meta.json hit for', file.name, 'duration:', sidecarMeta.duration);
    return {
      title: sidecarMeta.title,
      artist: sidecarMeta.artist,
      album: sidecarMeta.album,
      duration: sidecarMeta.duration,
      ...(sidecarMeta.lyrics != null && { lyrics: sidecarMeta.lyrics }),
      ...(sidecarMeta.syncedLyrics != null && { syncedLyrics: sidecarMeta.syncedLyrics }),
      ...(sidecarMeta.wordLyrics != null && { wordLyrics: sidecarMeta.wordLyrics }),
      ...(sidecarMeta.wordLyricsFormat != null && { wordLyricsFormat: sidecarMeta.wordLyricsFormat }),
      fileSize: file.size,
      lastModified: file.lastModified,
    };
  };

  /** Cover from the header buffer, fetching a truncated picture block separately. */
  const readCoverFromHeader = async (file: WebDAVFile, parsed: ReturnType<typeof parseMetadataFromBuffer>): Promise<string> => {
    let coverUrl = parsed.coverUrl || '';
    if (!coverUrl && parsed.coverNeededRange) {
      const { offset, length } = parsed.coverNeededRange;
      logger.info('[WebDAVReader] Cover truncated, fetching range:', offset, '-', offset + length);
      const coverBuffer = await fetchRange(file, offset, length);
      if (coverBuffer) coverUrl = parseCoverFromRange(coverBuffer, file.name, offset);
    }
    if (!coverUrl) return '';
    const dataUrl = await blobUrlToDataUrl(coverUrl);
    return dataUrl.startsWith('data:') ? dataUrl : '';
  };

  /**
   * 只读阶段：解析元数据（含封面），不上传服务端缓存。
   * - 封面一并拉取（通常在首 1MB buffer 内，额外 Range 仅极少数大封面）
   * - 封面保存到本地磁盘，后续通过 cover:// 协议懒加载，避免 data: URL 常驻内存
   */
  const readMetadata = async (file: WebDAVFile): Promise<CachedMetadata> => {
    const sidecar = await readSidecar(file);
    if (sidecar) return sidecar;

    const buffer = await fetchRange(file, 0, RANGE_SIZE);
    logger.info('[WebDAVReader] fetch header for', file.name, '→ buffer:', buffer ? `${buffer.byteLength} bytes` : 'null', 'via', provider.useDirectHeaderRead() ? 'direct' : 'cdn');
    if (!buffer) {
      logger.warn('[WebDAVReader] Header fetch returned null for', file.name, '- falling back to filename');
      return fallbackToFilename(file);
    }

    const parsed = parseMetadataFromBuffer(buffer, file.name, file.size);
    const { artist, title } = parseArtistTitleFromFilename(file.name);

    // VORBIS_COMMENT 截断：拉取完整块再解析
    if (parsed.vorbisCommentNeededRange) {
      const { offset, length } = parsed.vorbisCommentNeededRange;
      const vcBuffer = await fetchRange(file, offset, length);
      if (vcBuffer) {
        const vcResult = parseVorbisComment(vcBuffer);
        if (vcResult.title) parsed.title = vcResult.title;
        if (vcResult.artist) parsed.artist = vcResult.artist;
        if (vcResult.album) parsed.album = vcResult.album;
        if (vcResult.lyrics) parsed.lyrics = vcResult.lyrics;
        if (vcResult.syncedLyrics) parsed.syncedLyrics = vcResult.syncedLyrics;
      } else {
        logger.warn('[WebDAVReader] VORBIS_COMMENT refetch returned null for', file.name);
      }
    }

    const dataUrl = await readCoverFromHeader(file, parsed);
    const coverUrl = dataUrl ? await storeCoverLocally(dataUrl, file.path) : '';

    return {
      title: parsed.title || title,
      artist: parsed.artist || artist,
      album: parsed.album || 'Unknown Album',
      duration: parsed.duration || 0,
      ...(coverUrl ? { coverUrl } : {}),
      ...(parsed.lyrics !== undefined && { lyrics: parsed.lyrics }),
      ...(parsed.syncedLyrics !== undefined && { syncedLyrics: parsed.syncedLyrics }),
      fileSize: file.size,
      lastModified: file.lastModified,
    };
  };

  /**
   * 补充封面加载（兜底）：为 IndexedDB 中缺少 coverUrl 的曲目补充封面。
   * 拉取文件头重新解析封面。
   */
  const readCover = async (file: WebDAVFile): Promise<string | undefined> => {
    try {
      await indexedDBStorage.initialize();
      const cached = await indexedDBStorage.getWebdavMetadata(file.path);
      if (cached?.coverUrl) return cached.coverUrl;

      const buffer = await fetchRange(file, 0, RANGE_SIZE);
      if (!buffer) return undefined;

      const dataUrl = await readCoverFromHeader(file, parseMetadataFromBuffer(buffer, file.name, file.size));
      if (!dataUrl) return undefined;

      await indexedDBStorage.setWebdavMetadata(file.path, { ...cached, coverUrl: dataUrl });
      return dataUrl;
    } catch (e) {
      logger.warn('[WebDAVReader] readCover failed for', file.name, e);
      return undefined;
    }
  };

  return { readMetadata, readCover };
}
