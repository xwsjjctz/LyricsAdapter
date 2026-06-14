import { useCallback, useEffect, useRef } from 'react';
import { Track } from '../types';
import { logger } from '../services/logger';
import { webdavClient } from '../services/webdavClient';
import { useWebDAV, WebDAVDiffResult } from '../hooks/useWebDAV';
import { parseMetadataFromBuffer } from '../services/metadataService';
import { generateMetaJson } from '../services/webdavMetaService';
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

  useEffect(() => {
    registerCommand(
      'clear_webdav_cache',
      () => {
        const { clearWebdavCache, onLoadCloudTracks, loadWebDAVFiles, applyDiffResult } = debugActionsRef.current;
        clearWebdavCache();
        onLoadCloudTracks([]);
        setTimeout(() => {
          if (webdavClient.hasConfig()) {
            loadWebDAVFiles().then(result => {
              applyDiffResult(result);
            });
          }
        }, 50);
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
        if (!webdavClient.hasConfig()) {
          logger.warn('[LibraryView] WebDAV not configured');
          return;
        }
        logger.info('[scan_webdav] Listing WebDAV files...');
        const files = await webdavClient.listFiles('/');
        const audioFiles = files.filter(f => !f.isDirectory);
        logger.info(`[scan_webdav] Found ${audioFiles.length} audio files`);

        let scanned = 0;
        let skipped = 0;
        let generated = 0;
        const RANGE_SIZE = 1048576; // 1MB

        for (const file of audioFiles) {
          // Check if meta.json already exists
          const existingMeta = await webdavClient.fetchMetaJson(file.path);
          if (existingMeta) {
            skipped++;
            logger.debug(`[scan_webdav] Skip (has meta.json): ${file.name}`);
            continue;
          }

          logger.info(`[scan_webdav] Scanning: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)...`);
          try {
            const buffer = await webdavClient.fetchFileRange(file.path, 0, RANGE_SIZE);
            if (!buffer) {
              logger.warn(`[scan_webdav] Failed to fetch range for: ${file.name}`);
              continue;
            }

            const parsed = parseMetadataFromBuffer(buffer, file.name, file.size);
            const track: Track = {
              id: `webdav-${file.path}`,
              title: parsed.title || file.name.replace(/\.[^/.]+$/, ''),
              artist: parsed.artist || 'Unknown Artist',
              album: parsed.album || 'Unknown Album',
              duration: parsed.duration || 0,
              audioUrl: '',
              source: 'webdav',
              webdavPath: file.path,
              fileName: file.name,
              fileSize: file.size,
              ...(parsed.lyrics != null && { lyrics: parsed.lyrics }),
              ...(parsed.syncedLyrics != null && { syncedLyrics: parsed.syncedLyrics }),
              ...(parsed.coverUrl != null && { coverUrl: parsed.coverUrl }),
            };

            const metaJson = generateMetaJson(track);
            await webdavClient.uploadMetaJson(file.path, metaJson);
            generated++;
            logger.info(`[scan_webdav] Generated meta.json: ${file.name} — ${parsed.title} / ${parsed.artist} / ${parsed.album}`);
          } catch (err: any) {
            logger.error(`[scan_webdav] Failed: ${file.name} — ${err.message}`);
          }
          scanned++;
        }

        logger.info(`[scan_webdav] Done: scanned=${scanned} skipped=${skipped} generated=${generated}`);

        // Reload cloud tracks
        if (generated > 0) {
          const result = await loadWebDAVFiles();
          applyDiffResult(result);
        }
      },
      'Scan WebDAV audio files, parse metadata from 1MB header, generate missing meta.json'
    );

    registerCommand(
      'webdav_meta_update',
      async () => {
        if (!webdavClient.hasConfig()) {
          logger.warn('[webdav_meta_update] WebDAV not configured');
          return;
        }
        logger.info('[webdav_meta_update] Listing WebDAV files...');
        const files = await webdavClient.listFiles('/');
        const audioFiles = files.filter(f => !f.isDirectory);
        logger.info(`[webdav_meta_update] Found ${audioFiles.length} audio files`);

        let updated = 0;
        let skipped = 0;
        let failed = 0;
        const RANGE_SIZE = 1048576; // 1MB

        for (const file of audioFiles) {
          const existingMeta = await webdavClient.fetchMetaJson(file.path);
          if (existingMeta && existingMeta.duration > 0) {
            skipped++;
            logger.debug(`[webdav_meta_update] Skip (duration OK): ${file.name} duration=${existingMeta.duration}`);
            continue;
          }

          const reason = existingMeta
            ? `duration=${existingMeta.duration || 0}`
            : 'no meta.json';
          logger.info(`[webdav_meta_update] Re-parsing: ${file.name} (${reason})...`);

          try {
            const buffer = await webdavClient.fetchFileRange(file.path, 0, RANGE_SIZE);
            if (!buffer) {
              logger.warn(`[webdav_meta_update] Failed to fetch range for: ${file.name}`);
              failed++;
              continue;
            }

            const parsed = parseMetadataFromBuffer(buffer, file.name, file.size);
            const track: Track = {
              id: `webdav-${file.path}`,
              title: parsed.title || file.name.replace(/\.[^/.]+$/, ''),
              artist: parsed.artist || 'Unknown Artist',
              album: parsed.album || 'Unknown Album',
              duration: parsed.duration || 0,
              audioUrl: '',
              source: 'webdav',
              webdavPath: file.path,
              fileName: file.name,
              fileSize: file.size,
            };

            const metaJson = generateMetaJson(track);
            await webdavClient.uploadMetaJson(file.path, metaJson);
            updated++;
            logger.info(`[webdav_meta_update] ✓ ${file.name} — ${metaJson.title} / ${metaJson.artist} / duration=${metaJson.duration}`);
          } catch (err: any) {
            logger.error(`[webdav_meta_update] ✗ ${file.name} — ${err.message}`);
            failed++;
          }
        }

        logger.info(`[webdav_meta_update] Done: updated=${updated} skipped=${skipped} failed=${failed}`);

        if (updated > 0) {
          logger.info('[webdav_meta_update] Reloading cloud tracks...');
          const result = await loadWebDAVFiles();
          applyDiffResult(result);
        }
      },
      'Re-parse all WebDAV audio metadata and upload updated meta.json (fixes missing duration)'
    );
  }, []);

  return { loadProgress };
}
