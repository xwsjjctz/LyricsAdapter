import { protocol, app, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { logger } from '../logger';

// 缩略图尺寸上限（按最长边）。请求 ?size=N 时，若原图超过该尺寸则缩小后再返回，
// 避免把大尺寸原图解码成巨大的 GPU 纹理（FocusMode 背景经 blur 后分辨率差异不可见）。
const MAX_THUMBNAIL_SIZE = 512;
const FOCUS_THUMBNAIL_SIZES = [256, 512] as const;
const THUMBNAIL_SIZES = [128, 256, 512] as const;
export const THUMBNAIL_CACHE_DIR = '.thumbnails';
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const COVER_FILE_NAME = /^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i;
const STALE_TEMPORARY_FILE_AGE_MS = 5 * 60_000;
let temporaryFileSequence = 0;

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isDirectoryNotEmptyError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY';
}

function canonicalPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isPathInsideDirectory(rootDir: string, filePath: string): boolean {
  const relativePath = path.relative(rootDir, filePath);
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

function thumbnailCacheKey(coverPath: string): string {
  return createHash('sha256').update(canonicalPath(coverPath)).digest('hex').slice(0, 24);
}

function getThumbnailCacheDir(coverPath: string): string {
  return path.join(path.dirname(coverPath), THUMBNAIL_CACHE_DIR);
}

function getThumbnailPath(coverPath: string, size: number): string {
  return path.join(getThumbnailCacheDir(coverPath), `${thumbnailCacheKey(coverPath)}-${size}.jpg`);
}

function assertSafeCacheDirectory(cacheDir: string, create: boolean): void {
  if (!fs.existsSync(cacheDir)) {
    if (!create) return;
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const cacheStat = fs.lstatSync(cacheDir);
  if (!cacheStat.isDirectory() || cacheStat.isSymbolicLink()) {
    throw new Error(`Unsafe thumbnail cache directory: ${cacheDir}`);
  }
}

/** Write a complete file before exposing it at the final path. */
export function writeFileAtomically(filePath: string, data: Buffer): void {
  if (data.length === 0) {
    throw new Error(`Refusing to write an empty file: ${path.basename(filePath)}`);
  }

  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${temporaryFileSequence++}`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* retain the original error */ }
    }
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch (error) {
      logger.warn('[cover://] Failed to remove temporary thumbnail file:', temporaryPath, error);
    }
  }
}

function normalizeThumbnailSize(requestedSize: number): number {
  for (const size of THUMBNAIL_SIZES) {
    if (requestedSize <= size) return size;
  }
  return MAX_THUMBNAIL_SIZE;
}

/** Remove every derived size when the source cover is replaced or deleted. */
export function invalidateCoverThumbnails(coverPath: string): number {
  const cacheDir = getThumbnailCacheDir(coverPath);
  if (!fs.existsSync(cacheDir)) return 0;
  assertSafeCacheDirectory(cacheDir, false);

  const prefix = `${thumbnailCacheKey(coverPath)}-`;
  let removed = 0;
  let firstError: unknown;
  for (const file of fs.readdirSync(cacheDir)) {
    if (!file.startsWith(prefix)) continue;
    try {
      fs.unlinkSync(path.join(cacheDir, file));
      removed++;
    } catch (error) {
      if (isNotFoundError(error)) continue;
      logger.warn('[cover://] Failed to invalidate cached thumbnail:', file, error);
      firstError ??= error;
    }
  }

  if (firstError) throw firstError;
  return removed;
}

/** Remove cache entries whose source cover no longer exists. */
export function pruneOrphanCoverThumbnails(coverDir: string): number {
  const cacheDir = path.join(coverDir, THUMBNAIL_CACHE_DIR);
  if (!fs.existsSync(cacheDir)) return 0;
  assertSafeCacheDirectory(cacheDir, false);

  const activeKeys = new Set<string>();
  for (const entry of fs.readdirSync(coverDir, { withFileTypes: true })) {
    if (!entry.isFile() || !COVER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    activeKeys.add(thumbnailCacheKey(path.join(coverDir, entry.name)));
  }

  let removed = 0;
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
      removed++;
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
  return removed;
}

/**
 * Decode the source once and persist the requested display size. FocusMode's
 * 256/512 pair is generated together so its background and cover never decode
 * the same original twice. Library's 128px request stays isolated so scrolling
 * does not eagerly create large thumbnails for every track.
 */
export function ensureCoverThumbnailCache(coverPath: string, requestedSize: number): string | null {
  requestedSize = normalizeThumbnailSize(requestedSize);
  const sourceStat = fs.statSync(coverPath);
  const requestedPath = getThumbnailPath(coverPath, requestedSize);
  const requestedStat = fs.existsSync(requestedPath) ? fs.statSync(requestedPath) : null;
  if (requestedStat && requestedStat.size > 0 && requestedStat.mtimeMs >= sourceStat.mtimeMs) {
    return requestedPath;
  }

  const img = nativeImage.createFromPath(coverPath);
  if (img.isEmpty()) return null;

  const { width, height } = img.getSize();
  const longest = Math.max(width, height);
  if (longest <= requestedSize) return null;

  const cacheDir = getThumbnailCacheDir(coverPath);
  assertSafeCacheDirectory(cacheDir, true);
  const sizes = new Set<number>([
    requestedSize,
    ...(requestedSize >= 256 ? FOCUS_THUMBNAIL_SIZES : []),
  ]);

  for (const size of sizes) {
    if (size > MAX_THUMBNAIL_SIZE || longest <= size) continue;
    const thumbnailPath = getThumbnailPath(coverPath, size);
    const thumbnailStat = fs.existsSync(thumbnailPath) ? fs.statSync(thumbnailPath) : null;
    if (thumbnailStat && thumbnailStat.size > 0 && thumbnailStat.mtimeMs >= sourceStat.mtimeMs) continue;

    const resized = img.resize({
      width: Math.max(1, Math.round(width * size / longest)),
      height: Math.max(1, Math.round(height * size / longest)),
      quality: 'good',
    });
    writeFileAtomically(thumbnailPath, resized.toJPEG(80));
  }

  return fs.existsSync(requestedPath) ? requestedPath : null;
}

export function registerCoverProtocol(): void {
  app.whenReady().then(() => {
    const coverDir = path.join(app.getPath('userData'), 'covers');
    protocol.handle('cover', (request) => {
      const fullPath = request.url.slice('cover://'.length);
      const queryStart = fullPath.indexOf('?');
      const rawResource = (queryStart >= 0 ? fullPath.slice(0, queryStart) : fullPath)!;
      // Chromium canonicalizes standard custom-scheme hosts with a trailing
      // slash (`cover://name.jpg/`). Accept that one delimiter while still
      // rejecting every actual nested path below.
      const url = rawResource.endsWith('/') ? rawResource.slice(0, -1) : rawResource;
      let decodedUrl: string;
      try {
        decodedUrl = decodeURIComponent(url);
      } catch {
        return new Response('Bad Request', { status: 400 });
      }

      // Saved covers are flat files with sanitized names. Reject separators
      // before resolving so encoded traversal and Windows separators cannot
      // address sibling directories or the derived cache itself.
      if (!COVER_FILE_NAME.test(decodedUrl) || decodedUrl.includes('/') || decodedUrl.includes('\\')) {
        return new Response('Forbidden', { status: 403 });
      }
      const coverPath = path.join(coverDir, decodedUrl);

      const resolvedPath = path.resolve(coverPath);
      const resolvedCoverDir = path.resolve(coverDir);
      if (!isPathInsideDirectory(resolvedCoverDir, resolvedPath)) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(resolvedPath)) {
        logger.warn('[cover://] File not found:', resolvedPath);
        return new Response('Not Found', { status: 404 });
      }

      const sourceStat = fs.lstatSync(resolvedPath);
      if (!sourceStat.isFile() && !sourceStat.isSymbolicLink()) {
        return new Response('Not Found', { status: 404 });
      }

      const realCoverDir = canonicalPath(coverDir);
      const realCoverPath = canonicalPath(resolvedPath);
      if (!isPathInsideDirectory(realCoverDir, realCoverPath) || !fs.statSync(realCoverPath).isFile()) {
        return new Response('Forbidden', { status: 403 });
      }

      const ext = path.extname(realCoverPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp'
      };
      const mimeType = mimeTypes[ext] || 'image/jpeg';

      // 解析 ?size=N（缩略图）。不存在或 <=0 时返回原图。
      let requestedSize = 0;
      const params = queryStart >= 0
        ? new URLSearchParams(fullPath.slice(queryStart + 1))
        : new URLSearchParams();
      if (queryStart >= 0) {
        const sizeParam = params.get('size');
        if (sizeParam) {
          const parsed = parseInt(sizeParam, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            requestedSize = normalizeThumbnailSize(parsed);
          }
        }
      }

      // Only content-versioned URLs are immutable. Legacy URLs remain valid,
      // but bypass Chromium's persistent cache so replacing the source cannot
      // leave the old image visible for a year.
      const hasContentVersion = /^[a-f0-9]{16}$/i.test(params.get('v') ?? '');
      const cacheControl = hasContentVersion
        ? 'public, max-age=31536000, immutable'
        : 'no-store';

      if (requestedSize > 0) {
        try {
          const thumbnailPath = ensureCoverThumbnailCache(realCoverPath, requestedSize);
          if (thumbnailPath) {
            return new Response(fs.readFileSync(thumbnailPath), {
              headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': cacheControl,
              },
            });
          }
        } catch (err) {
          logger.warn('[cover://] thumbnail cache failed, falling back to original:', err);
        }
      }

      const fileData = fs.readFileSync(realCoverPath);
      return new Response(fileData, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': cacheControl,
        }
      });
    });
  });
}
