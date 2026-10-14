import { indexedDBStorage } from '../indexedDBStorage';
import { logger } from '../logger';
import type { CachedMetadata } from './trackMapping';

/** Per-file WebDAV metadata cached in IndexedDB (rebuildable). */

export async function loadMetadataCache(): Promise<Map<string, CachedMetadata>> {
  try {
    await indexedDBStorage.initialize();
    const entries = await indexedDBStorage.getAllWebdavMetadata();
    return new Map(Object.entries(entries));
  } catch (e) {
    logger.error('[WebDAVMetadataCache] Failed to load metadata cache from IndexedDB:', e);
    return new Map();
  }
}

/** 原子替换：单事务清空+写入，避免崩溃后半份数据 */
export async function saveMetadataCache(cache: Map<string, CachedMetadata>): Promise<void> {
  try {
    await indexedDBStorage.initialize();
    await indexedDBStorage.replaceAllWebdavMetadata(Object.fromEntries(cache));
  } catch (e) {
    logger.error('[WebDAVMetadataCache] Failed to save metadata cache to IndexedDB:', e);
  }
}

/** 迁移旧 data: 封面到本地磁盘，返回 cover:// URL */
export async function migrateCachedCover(
  meta: CachedMetadata,
  webdavPath: string,
  storeCover: (coverUrl: string, webdavPath: string) => Promise<string>,
): Promise<CachedMetadata> {
  if (!meta.coverUrl?.startsWith('data:')) return meta;
  const coverUrl = await storeCover(meta.coverUrl, webdavPath);
  return coverUrl === meta.coverUrl ? meta : { ...meta, coverUrl };
}
