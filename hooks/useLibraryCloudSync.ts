import { useCallback, useEffect, useRef } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { webdavClient } from '../services/webdavClient';
import { useWebDAV, WebDAVDiffResult } from '../hooks/useWebDAV';
import { parseMetadataFromBuffer, parseCoverFromRange } from '../services/metadataService';
import { metadataFolderService } from '../services/webdav/metadataFolderService';
import { getEffectiveConfig } from '../services/webdav/providerConfig';
import { registerCommand } from '../services/debugCommands';

interface UseLibraryCloudSyncParams {
  dataSource: 'local' | 'cloud';
  onLoadCloudTracks: (tracks: Track[]) => void;
  onMergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
}

/**
 * WebDAV cloud-track synchronization for the cloud slot:
 * - Auto-loads cloud tracks once when dataSource first becomes 'cloud'
 * - Applies full/diff results back to the parent via callbacks
 * - Registers global debug commands (clear cache / sync / scan / meta update)
 *
 * Returns only loadProgress (the sole value the UI consumes). All other
 * internals (loadWebDAVFiles, clearWebdavCache, applyDiffResult) stay private.
 */
export function useLibraryCloudSync({ dataSource, onLoadCloudTracks, onMergeCloudTracks }: UseLibraryCloudSyncParams) {
  const { loadProgress, loadWebDAVFiles, clearWebdavCache } = useWebDAV();

  const applyDiffResult = useCallback((result: WebDAVDiffResult) => {
    if (result.type === 'full') {
      onLoadCloudTracks(result.tracks);
    } else {
      onMergeCloudTracks(result.added, result.removed, result.updated);
    }
  }, [onLoadCloudTracks, onMergeCloudTracks]);

  // Auto-load WebDAV on startup if dataSource is 'cloud'
  const webdavLoadAttemptedRef = useRef(false);
  useEffect(() => {
    if (dataSource !== 'cloud' || !webdavClient.hasConfig()) return;
    if (webdavLoadAttemptedRef.current) return;
    webdavLoadAttemptedRef.current = true;
    (async () => {
      try {
        const result = await loadWebDAVFiles();
        applyDiffResult(result);
      } catch (err) {
        logger.warn('[LibraryView] Auto WebDAV load failed:', err);
      }
    })();
  }, [dataSource]);

  // Global debug commands — 注册一次后常驻，通过 ref 保持最新回调
  const debugActionsRef = useRef({
    clearWebdavCache,
    loadWebDAVFiles,
    applyDiffResult,
    onLoadCloudTracks,
    onMergeCloudTracks,
  });
  debugActionsRef.current = { clearWebdavCache, loadWebDAVFiles, applyDiffResult, onLoadCloudTracks, onMergeCloudTracks };

  /**
   * blob: URL → data: URL 转换，用于封面持久化。
   */
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

  /**
   * 扫描 / 更新元数据的通用逻辑（增量合并版）。
   *
   * forceAll=true  -> 强制解析所有文件（scan_webdav_audio）
   * forceAll=false -> 只解析缺失/无效的（webdav_meta_update）：
   *                   无 existing / duration<=0 / size|lastModified 变化 / 缺 coverUrl
   *
   * 关键：Metadata/ 模式下，解析结果与 existingIndex 合并后再整体上传，
   *       未变化的条目保留，不再被覆盖。同时用 PROPFIND 清理已删文件。
   */
  async function runScanOrMetaUpdate({ forceAll }: { forceAll: boolean }) {
    const davConfig = webdavClient.getConfig();
    const providerConfig = getEffectiveConfig(davConfig?.serverUrl || '', davConfig?.readonly);
    const useFolder = providerConfig.useMetadataFolder;
    const skipCdn = providerConfig.skipCdnForHeaderRead;
    const batchSize = providerConfig.batchSize;
    const RANGE_SIZE = 1048576;

    logger.info(`[scan/meta] Listing WebDAV files...`);
    const files = await webdavClient.listFiles('/');
    const audioFiles = files.filter(f => !f.isDirectory);
    const audioPaths = new Set(audioFiles.map(f => f.path));
    logger.info(`[scan/meta] Found ${audioFiles.length} audio files, useMetadataFolder=${useFolder}, forceAll=${forceAll}`);

    // === DEBUG: PROPFIND 获取的音频文件列表 ===
    logger.info('========== PROPFIND Audio Files ==========');
    for (const f of audioFiles) {
      logger.info(`[PROPFIND] ${f.path} | ${f.name} | size=${f.size} | modified=${f.lastModified}`);
    }
    logger.info(`========== PROPFIND Total: ${audioFiles.length} ==========`);

    // 加载现有 index（作为增量基准）
    const existingIndex = useFolder ? (await metadataFolderService.loadIndex()) : null;
    if (useFolder) {
      if (existingIndex) {
        logger.info(`[INDEX] Loaded ${Object.keys(existingIndex).length} entries from Metadata/_metadata.json`);
        logger.info('========== Metadata/_metadata.json Entries ==========');
        let withCover = 0;
        let withoutCover = 0;
        for (const [path, entry] of Object.entries(existingIndex)) {
          const hasCover = !!entry.coverUrl;
          if (hasCover) withCover++; else withoutCover++;
          logger.info(`[INDEX] ${path} | ${entry.title} / ${entry.artist} | duration=${entry.duration} | ${hasCover ? 'HAS_COVER' : 'NO_COVER'}`);
        }
        logger.info(`========== INDEX Total: ${Object.keys(existingIndex).length} (withCover=${withCover}, withoutCover=${withoutCover}) ==========`);
      } else {
        logger.info('[INDEX] No Metadata/_metadata.json found, will parse all files');
      }
    }

    // 决定哪些文件需要解析
    type ParsedEntry = {
      meta: { title: string; artist: string; album: string; duration: number; fileSize: number; fileName: string; lastModified: string; lyrics?: string; syncedLyrics?: { time: number; text: string }[] };
      coverUrl?: string;
    };
    const parsedEntries: Record<string, ParsedEntry> = {};

    const needsParse = (file: { path: string; size: number; lastModified: string }): boolean => {
      if (forceAll) return true;
      if (useFolder && existingIndex) {
        const existing = existingIndex[file.path];
        if (!existing) return true;                                       // 新文件
        if (!(existing.duration > 0)) return true;                        // 时长无效
        if (existing.fileSize !== file.size) return true;                 // 大小变化
        if (existing.lastModified !== file.lastModified) return true;     // 修改时间变化
        if (!existing.coverUrl) return true;                              // 缺封面（含旧版 coverHash 迁移）
        return false;                                                     // 完整，跳过
      }
      return true; // 旧模式/无 index，全部解析
    };

    let processed = 0;
    let skipped = 0;
    const toParse = audioFiles.filter(needsParse);
    logger.info(`[scan/meta] Need to parse: ${toParse.length} / ${audioFiles.length} (skipping ${audioFiles.length - toParse.length})`);

    for (let i = 0; i < toParse.length; i += batchSize) {
      const batch = toParse.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          // 旧模式且非强制：检查 .meta.json 是否已有有效时长
          if (!forceAll && !useFolder) {
            const existing = await webdavClient.fetchMetaJson(file.path);
            if (existing && existing.duration > 0) {
              return { file, existingMetaJson: existing };
            }
          }

          logger.info(`[scan/meta] ${forceAll ? 'Scan' : 'Re-parse'}: ${file.name}...`);
          // 带重试的文件头读取（最多 3 次，退避 1s/2s）
          let buffer: ArrayBuffer | null = null;
          for (let attempt = 0; attempt <= 2; attempt++) {
            try {
              buffer = skipCdn
                ? await webdavClient.fetchFileRangeDirect(file.path, 0, RANGE_SIZE)
                : await webdavClient.fetchFileRange(file.path, 0, RANGE_SIZE);
              if (buffer) break;
            } catch (err) {
              logger.warn(`[scan/meta] Header fetch failed for ${file.name} (attempt ${attempt + 1}/3):`, err);
            }
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
          if (!buffer) {
            logger.warn(`[scan/meta] Failed to fetch header: ${file.name}`);
            return { file, bufferFailed: true as const };
          }

          const parsed = parseMetadataFromBuffer(buffer, file.name, file.size);
          const nameFallback = file.name.replace(/\.[^/.]+$/, '');

          // 解析封面
          let coverUrl: string | undefined;
          let coverBlob = parsed.coverUrl || '';
          if (!coverBlob && parsed.coverNeededRange) {
            const { offset, length } = parsed.coverNeededRange;
            let coverBuffer: ArrayBuffer | null = null;
            for (let attempt = 0; attempt <= 2; attempt++) {
              try {
                coverBuffer = skipCdn
                  ? await webdavClient.fetchFileRangeDirect(file.path, offset, offset + length)
                  : await webdavClient.fetchFileRange(file.path, offset, offset + length);
                if (coverBuffer) break;
              } catch (err) {
                logger.warn(`[scan/meta] Cover fetch failed for ${file.name} (attempt ${attempt + 1}/3):`, err);
              }
              if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
            if (coverBuffer) coverBlob = parseCoverFromRange(coverBuffer, file.name, offset);
          }
          if (coverBlob) {
            const dataUrl = await blobUrlToDataUrl(coverBlob);
            if (dataUrl.startsWith('data:')) coverUrl = dataUrl;
          }

          return {
            file,
            parsed: {
              meta: {
                title: parsed.title || nameFallback,
                artist: parsed.artist || 'Unknown Artist',
                album: parsed.album || 'Unknown Album',
                duration: parsed.duration || 0,
                fileSize: file.size,
                fileName: file.name,
                lastModified: file.lastModified,
                ...(parsed.lyrics !== undefined && { lyrics: parsed.lyrics }),
                ...(parsed.syncedLyrics !== undefined && { syncedLyrics: parsed.syncedLyrics }),
              },
              ...(coverUrl ? { coverUrl } : {}),
            } as ParsedEntry,
          };
        })
      );

      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value) continue;
        const { file, parsed, bufferFailed, existingMetaJson } = r.value as {
          file: { path: string; size: number; lastModified: string; name: string };
          parsed?: ParsedEntry;
          bufferFailed?: boolean;
          existingMetaJson?: { title: string; artist: string; album: string; duration: number };
        };
        if (bufferFailed) {
          skipped++;
          continue;
        }
        if (parsed) {
          parsedEntries[file.path] = parsed;
          processed++;
        } else if (existingMetaJson) {
          // 旧模式：.meta.json 已有，跳过解析
          skipped++;
        }
      }
    }

    logger.info(`[scan/meta] Parsed: processed=${processed} skipped=${skipped}`);

    if (useFolder) {
      // Metadata/ 模式：合并 existingIndex + parsedEntries，用 PROPFIND 清理已删文件
      const merged: Record<string, import('../services/webdav/metadataFolderService').MetadataFolderEntry> = {};

      // 1. 先铺底：existingIndex 中仍在服务器上的条目（未变化的保留原样，含 coverUrl）
      if (existingIndex) {
        for (const [path, entry] of Object.entries(existingIndex)) {
          if (audioPaths.has(path)) {
            merged[path] = entry;
          } else {
            logger.info(`[scan/meta] Removing stale entry from index: ${path}`);
          }
        }
      }

      // 2. 覆盖：本次解析的条目（含最新 coverUrl）
      for (const [path, entry] of Object.entries(parsedEntries)) {
        merged[path] = {
          title: entry.meta.title,
          artist: entry.meta.artist,
          album: entry.meta.album,
          duration: entry.meta.duration,
          fileSize: entry.meta.fileSize,
          fileName: entry.meta.fileName,
          lastModified: entry.meta.lastModified,
          ...(entry.coverUrl ? { coverUrl: entry.coverUrl } : {}),
          ...(entry.meta.lyrics !== undefined && { lyrics: entry.meta.lyrics }),
          ...(entry.meta.syncedLyrics !== undefined && { syncedLyrics: entry.meta.syncedLyrics }),
        };
      }

      const coverCount = Object.values(merged).filter(e => e.coverUrl).length;
      await metadataFolderService.saveIndex(merged);
      metadataFolderService.clearCache();
      logger.info(`[scan/meta] ✓ Uploaded Metadata/_metadata.json: ${Object.keys(merged).length} entries (withCover=${coverCount})`);
    } else {
      // 旧模式（通用 WebDAV）：逐个上传 .meta.json
      for (const [path, entry] of Object.entries(parsedEntries)) {
        const metaJson = {
          title: entry.meta.title,
          artist: entry.meta.artist,
          album: entry.meta.album || 'Unknown Album',
          duration: entry.meta.duration || 0,
          fileSize: entry.meta.fileSize,
          fileName: entry.meta.fileName,
          lastModified: entry.meta.lastModified,
          ...(entry.meta.lyrics !== undefined && { lyrics: entry.meta.lyrics }),
          ...(entry.meta.syncedLyrics !== undefined && { syncedLyrics: entry.meta.syncedLyrics }),
        };
        await webdavClient.uploadMetaJson(path, metaJson);
      }
      logger.info(`[scan/meta] ✓ Uploaded ${Object.keys(parsedEntries).length} meta.json files`);
    }
  }

  useEffect(() => {
    registerCommand(
      'clear_webdav_cache',
      async () => {
        const { clearWebdavCache, onLoadCloudTracks, loadWebDAVFiles, applyDiffResult } = debugActionsRef.current;
        await clearWebdavCache();
        onLoadCloudTracks([]);
        if (webdavClient.hasConfig()) {
          const result = await loadWebDAVFiles();
          applyDiffResult(result);
        }
      },
      'Clear WebDAV cache and reload cloud tracks'
    );

    registerCommand(
      'sync_webdav',
      () => {
        if (!webdavClient.hasConfig()) {
          logger.warn('[LibraryView] WebDAV not configured');
          return;
        }
        const { loadWebDAVFiles, onMergeCloudTracks, onLoadCloudTracks } = debugActionsRef.current;
        loadWebDAVFiles().then(result => {
          if (result.type === 'full') {
            logger.info('[LibraryView] sync_webdav: full load, ' + result.tracks.length + ' tracks');
            onLoadCloudTracks(result.tracks);
          } else {
            logger.info('[LibraryView] sync_webdav: diff — added=' + result.added.length + ' removed=' + result.removed.length + ' updated=' + result.updated.length);
            onMergeCloudTracks(result.added, result.removed, result.updated);
          }
        });
      },
      'Manually trigger WebDAV sync'
    );

    registerCommand(
      'scan_webdav_audio',
      async () => {
        if (!webdavClient.hasConfig()) return;
        await runScanOrMetaUpdate({ forceAll: true });
        const result = await loadWebDAVFiles();
        applyDiffResult(result);
      },
      'Scan WebDAV: parse metadata for all files without cache, upload to Metadata/ folder'
    );

    registerCommand(
      'webdav_meta_update',
      async () => {
        if (!webdavClient.hasConfig()) return;
        await runScanOrMetaUpdate({ forceAll: false });
        const result = await loadWebDAVFiles();
        applyDiffResult(result);
      },
      'WebDAV meta update: re-parse files with missing/invalid duration, upload to Metadata/ folder'
    );
  }, []);

  return { loadProgress };
}
