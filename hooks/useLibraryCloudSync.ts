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
   * 扫描 / 更新元数据的通用逻辑。
   * forceAll=true  -> 强制解析所有文件（scan_webdav_audio）
   * forceAll=false -> 只解析缺少有效时长或缓存的（webdav_meta_update）
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
    logger.info(`[scan/meta] Found ${audioFiles.length} audio files, useMetadataFolder=${useFolder}`);

    // === DEBUG: PROPFIND 获取的音频文件列表 ===
    logger.info('========== PROPFIND Audio Files ==========');
    for (const f of audioFiles) {
      logger.info(`[PROPFIND] ${f.path} | ${f.name} | size=${f.size} | modified=${f.lastModified}`);
    }
    logger.info(`========== PROPFIND Total: ${audioFiles.length} ==========`);

    // === DEBUG: Metadata/_metadata.json 列表 + 封面映射 ===
    let existingIndex: Record<string, import('../services/webdav/metadataFolderService').MetadataFolderEntry> | null = null;
    if (useFolder) {
      existingIndex = await metadataFolderService.loadIndex();
      if (existingIndex) {
        logger.info(`[INDEX] Loaded ${Object.keys(existingIndex).length} entries from Metadata/_metadata.json`);

        logger.info('========== Metadata/_metadata.json Entries ==========');
        for (const [path, entry] of Object.entries(existingIndex)) {
          const cover = entry.coverHash ? `cover=${entry.coverHash.substring(0, 8)}` : 'NO_COVER';
          logger.info(`[INDEX] ${path} | ${entry.title} / ${entry.artist} | duration=${entry.duration} | ${cover}`);
        }
        logger.info(`========== INDEX Total: ${Object.keys(existingIndex).length} ==========`);

        logger.info('========== Cover → Songs Mapping ==========');
        const coverToSongs = new Map<string, string[]>();
        for (const [path, entry] of Object.entries(existingIndex)) {
          if (entry.coverHash) {
            const songs = coverToSongs.get(entry.coverHash) || [];
            songs.push(path);
            coverToSongs.set(entry.coverHash, songs);
          }
        }
        for (const [hash, songs] of coverToSongs) {
          logger.info(`[COVER] ${hash.substring(0, 12)} → ${songs.length} songs: ${songs.map(s => s.split('/').pop()).join(', ')}`);
        }
        logger.info(`========== Unique Covers: ${coverToSongs.size} ==========`);

        if (!forceAll) {
          logger.info('[scan/meta] webdav_meta_update mode: will skip entries that are valid + have cover');
        }
      } else {
        logger.info('[INDEX] No Metadata/_metadata.json found, will parse all files');
      }
    }

    // 收集所有解析结果，统一上传
    const parsedEntries: Record<string, {
      meta: { title: string; artist: string; album: string; duration: number; fileSize: number; fileName: string; lastModified: string; lyrics?: string; syncedLyrics?: { time: number; text: string }[] };
      coverUrl?: string;
    }> = {};

    let processed = 0;
    let skipped = 0;

    for (let i = 0; i < audioFiles.length; i += batchSize) {
      const batch = audioFiles.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          // webdav_meta_update + Metadata/ 模式：检查现有 index
          if (!forceAll && existingIndex) {
            const existing = existingIndex[file.path];
            if (existing && existing.duration > 0 && existing.fileSize === file.size && existing.lastModified === file.lastModified) {
              if (existing.coverHash) {
                skipped++;
                return null;
              }
              // 缺封面，继续解析
            }
          }

          // 旧模式：检查 .meta.json
          if (!forceAll && !useFolder) {
            const existing = await webdavClient.fetchMetaJson(file.path);
            if (existing && existing.duration > 0) {
              skipped++;
              return null;
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
            return null;
          }

          const parsed = parseMetadataFromBuffer(buffer, file.name, file.size);
          const nameFallback = file.name.replace(/\.[^/.]+$/, '');

          // 解析封面
          let coverUrl: string | undefined;
          let coverBlob = parsed.coverUrl || '';
          if (!coverBlob && parsed.coverNeededRange) {
            const { offset, length } = parsed.coverNeededRange;
            // 封面拉取也带重试
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
            path: file.path,
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
          };
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          parsedEntries[r.value.path] = r.value;
          processed++;
        }
      }
    }

    logger.info(`[scan/meta] Parsed: processed=${processed} skipped=${skipped} total=${audioFiles.length}`);

    if (processed === 0) {
      logger.info(`[scan/meta] Nothing to update`);
      return;
    }

    if (useFolder) {
      // Metadata/ 文件夹模式：上传封面 + 索引
      const folderEntries: Record<string, import('../services/webdav/metadataFolderService').MetadataFolderEntry> = {};

      for (const [path, entry] of Object.entries(parsedEntries)) {
        const baseEntry = {
          title: entry.meta.title,
          artist: entry.meta.artist,
          album: entry.meta.album,
          duration: entry.meta.duration,
          fileSize: entry.meta.fileSize,
          fileName: entry.meta.fileName,
          lastModified: entry.meta.lastModified,
          ...(entry.meta.lyrics !== undefined && { lyrics: entry.meta.lyrics }),
          ...(entry.meta.syncedLyrics !== undefined && { syncedLyrics: entry.meta.syncedLyrics }),
        };

        if (entry.coverUrl) {
          const result = await metadataFolderService.uploadCover(entry.coverUrl);
          folderEntries[path] = result
            ? { ...baseEntry, coverHash: result.hash, coverMime: result.mime }
            : baseEntry;
        } else {
          folderEntries[path] = baseEntry;
        }
      }

      await metadataFolderService.saveIndex(folderEntries);
      metadataFolderService.clearCache();
      logger.info(`[scan/meta] ✓ Uploaded ${Object.keys(folderEntries).length} entries to Metadata/ folder`);
    } else {
      // 旧模式（通用 WebDAV）：逐个上传 .meta.json
      for (const [, entry] of Object.entries(parsedEntries)) {
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
        // 提取路径中最后一个音频文件的路径对应的 .meta.json 路径
        const audioPath = Object.keys(parsedEntries).find(k => parsedEntries[k] === entry);
        if (audioPath) {
          await webdavClient.uploadMetaJson(audioPath, metaJson);
        }
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
