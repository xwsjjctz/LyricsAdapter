import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
// 与 IPC handler / save-cover-thumbnail 共用同一份封面 id 逻辑。本进程被 fork() 拉起，
// 不能 import electron，故只引入零 electron 依赖的 webdavCoverId 模块。
import { sanitizeTrackId, computeWebdavCoverId } from './utils/webdavCoverId';

const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const THUMBNAIL_CACHE_DIR = '.thumbnails';
const STALE_TEMPORARY_FILE_AGE_MS = 5 * 60_000;

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isDirectoryNotEmptyError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY';
}

// Keep this key contract in sync with protocols/coverProtocol.ts. This worker
// intentionally cannot import that module because it has an Electron runtime
// dependency and is launched with Node's child_process.fork().
function thumbnailCacheKey(coverPath: string): string {
  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync.native(coverPath);
  } catch {
    canonicalPath = path.resolve(coverPath);
  }
  return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 24);
}

function assertSafeThumbnailDirectory(cacheDir: string): void {
  const stat = fs.lstatSync(cacheDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe thumbnail cache directory: ${cacheDir}`);
  }
}

function removeThumbnailsForKey(cacheDir: string, key: string): void {
  if (!fs.existsSync(cacheDir)) return;
  assertSafeThumbnailDirectory(cacheDir);
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(`${key}-`)) continue;
    try {
      fs.unlinkSync(path.join(cacheDir, entry.name));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
}

function pruneThumbnailCache(cacheDir: string, activeKeys: Set<string>): void {
  if (!fs.existsSync(cacheDir)) return;
  assertSafeThumbnailDirectory(cacheDir);
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const key = /^([a-f0-9]{24})-(?:128|256|512)\.jpg$/.exec(entry.name)?.[1];
    if (key && activeKeys.has(key)) continue;
    if (entry.name.includes('.tmp-')) {
      let age: number;
      try {
        age = Date.now() - fs.statSync(path.join(cacheDir, entry.name)).mtimeMs;
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw error;
      }
      if (age < STALE_TEMPORARY_FILE_AGE_MS) continue;
    }
    try {
      fs.unlinkSync(path.join(cacheDir, entry.name));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }
  let cacheIsEmpty = false;
  try {
    cacheIsEmpty = fs.readdirSync(cacheDir).length === 0;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  if (cacheIsEmpty) {
    try {
      fs.rmdirSync(cacheDir);
    } catch (error) {
      if (!isNotFoundError(error) && !isDirectoryNotEmptyError(error)) throw error;
    }
  }
}

function runCleanup(userDataPath: string, activeTrackIds: string[]): void {
  const results = {
    coversRemoved: 0,
    audioDirDeleted: false,
    libraryJsonDeleted: false,
    errors: [] as string[]
  };

  const shouldDeleteOrphanSources = activeTrackIds.length > 0;
  if (!shouldDeleteOrphanSources) {
    console.log('[Cleanup] No active tracks, preserving source covers');
  }

  const activeSet = new Set<string>();
  for (const id of activeTrackIds) {
    activeSet.add(sanitizeTrackId(id));
    // WebDAV 封面文件名含 pathHash 前缀，也加入匹配集
    const coverId = computeWebdavCoverId(id);
    if (coverId) activeSet.add(coverId);
  }
  const coversDir = path.join(userDataPath, 'covers');

  if (fs.existsSync(coversDir)) {
    try {
      const thumbnailCacheDir = path.join(coversDir, THUMBNAIL_CACHE_DIR);
      const activeThumbnailKeys = new Set<string>();
      const entries = fs.readdirSync(coversDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!COVER_EXTENSIONS.has(ext)) continue;

        const file = entry.name;
        const trackId = path.basename(file, ext);
        const coverPath = path.join(coversDir, file);
        const cacheKey = thumbnailCacheKey(coverPath);
        if (shouldDeleteOrphanSources && !activeSet.has(trackId)) {
          try {
            // Derived files go first. If permissions prevent invalidation,
            // leave the source intact and retry on the next startup.
            removeThumbnailsForKey(thumbnailCacheDir, cacheKey);
            fs.unlinkSync(coverPath);
            results.coversRemoved++;
          } catch (e) {
            results.errors.push(`Failed to delete cover ${file}: ${(e as Error).message}`);
          }
        } else {
          activeThumbnailKeys.add(cacheKey);
        }
      }

      try {
        // Also removes interrupted temporary writes and derived files whose
        // source disappeared before this cleanup implementation existed.
        pruneThumbnailCache(thumbnailCacheDir, activeThumbnailKeys);
      } catch (e) {
        results.errors.push(`Failed to prune cover thumbnails: ${(e as Error).message}`);
      }
    } catch (e) {
      results.errors.push(`Failed to read covers directory: ${(e as Error).message}`);
    }
  }

  const audioDir = path.join(userDataPath, 'audio');
  if (fs.existsSync(audioDir)) {
    try {
      fs.rmSync(audioDir, { recursive: true, force: true });
      results.audioDirDeleted = true;
      console.log('[Cleanup] Deleted audio directory');
    } catch (e) {
      results.errors.push(`Failed to delete audio directory: ${(e as Error).message}`);
    }
  }

  const libraryJsonPath = path.join(userDataPath, 'library.json');
  if (fs.existsSync(libraryJsonPath)) {
    try {
      fs.unlinkSync(libraryJsonPath);
      results.libraryJsonDeleted = true;
      console.log('[Cleanup] Deleted legacy library.json');
    } catch (e) {
      results.errors.push(`Failed to delete library.json: ${(e as Error).message}`);
    }
  }

  console.log('[Cleanup] Results:', JSON.stringify(results));
}

const userDataPath = process.argv[2];
const activeTrackIdsStr = process.argv[3] || '[]';

if (!userDataPath) {
  console.error('[Cleanup] Missing userDataPath argument');
  process.exit(1);
}

let activeTrackIds: string[] = [];
try {
  activeTrackIds = JSON.parse(activeTrackIdsStr);
} catch {
  activeTrackIds = [];
}

console.log('[Cleanup] Starting cleanup...');
runCleanup(userDataPath, activeTrackIds);
console.log('[Cleanup] Done');
process.exit(0);
