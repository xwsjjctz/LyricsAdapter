import { protocol, app, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger';

// 缩略图尺寸上限（按最长边）。请求 ?size=N 时，若原图超过该尺寸则缩小后再返回，
// 避免把大尺寸原图解码成巨大的 GPU 纹理（FocusMode 背景经 blur 后分辨率差异不可见）。
const MAX_THUMBNAIL_SIZE = 512;

export function registerCoverProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'cover',
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: false
      }
    }
  ]);

  app.whenReady().then(() => {
    const coverDir = path.join(app.getPath('userData'), 'covers');
    protocol.handle('cover', (request) => {
      const fullPath = request.url.slice('cover://'.length);
      const queryStart = fullPath.indexOf('?');
      const url = (queryStart >= 0 ? fullPath.slice(0, queryStart) : fullPath)!;
      const decodedUrl = decodeURIComponent(url);
      const coverPath = path.join(coverDir, decodedUrl);

      const resolvedPath = path.resolve(coverPath);
      const resolvedCoverDir = path.resolve(coverDir);
      if (!resolvedPath.startsWith(resolvedCoverDir)) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(resolvedPath)) {
        logger.warn('[cover://] File not found:', resolvedPath);
        return new Response('Not Found', { status: 404 });
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp'
      };
      const mimeType = mimeTypes[ext] || 'image/jpeg';

      // 解析 ?size=N（缩略图）。不存在或 <=0 时返回原图。
      let requestedSize = 0;
      if (queryStart >= 0) {
        const params = new URLSearchParams(fullPath.slice(queryStart + 1));
        const sizeParam = params.get('size');
        if (sizeParam) {
          const parsed = parseInt(sizeParam, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            requestedSize = Math.min(parsed, MAX_THUMBNAIL_SIZE);
          }
        }
      }

      if (requestedSize > 0) {
        try {
          const img = nativeImage.createFromPath(resolvedPath);
          if (!img.isEmpty()) {
            const { width, height } = img.getSize();
            const longest = Math.max(width, height);
            if (longest > requestedSize) {
              // 等比缩放到 requestedSize（按最长边）
              const resized = img.resize({
                width: Math.round(width * requestedSize / longest),
                height: Math.round(height * requestedSize / longest),
                quality: 'good',
              });
              // resize 后统一输出为 JPEG（体积小、解码纹理尺寸由像素数决定，与格式无关）
              const buffer = resized.toJPEG(80);
              return new Response(buffer, {
                headers: {
                  'Content-Type': 'image/jpeg',
                  'Cache-Control': 'public, max-age=31536000',
                },
              });
            }
          }
        } catch (err) {
          logger.warn('[cover://] thumbnail resize failed, falling back to original:', err);
        }
      }

      const fileData = fs.readFileSync(resolvedPath);
      return new Response(fileData, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000'
        }
      });
    });
  });
}