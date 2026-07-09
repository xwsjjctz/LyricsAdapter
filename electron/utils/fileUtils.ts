import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';

export function sanitizeFileName(fileName: string): string {
  const sanitized = fileName.replace(/[\/\\]/g, '').replace(/\.\./g, '').replace(/[<>:"|?*]/g, '');
  if (sanitized !== fileName || sanitized.length === 0) {
    throw new Error('Invalid file name');
  }
  return sanitized;
}

// sanitizeTrackId 已迁移至 ./webdavCoverId（与 fork 出去的 cleanup 子进程共享同一份逻辑，
// 子进程不能 import electron）。此处 re-export 保持现有 `import { sanitizeTrackId } from './utils/fileUtils'` 兼容。
export { sanitizeTrackId } from './webdavCoverId';

export function expandHomeDir(inputPath: string): string {
  if (inputPath.startsWith('~/') || inputPath === '~') {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

export function validateSourcePath(sourcePath: string): boolean {
  try {
    const resolved = path.resolve(sourcePath);
    const homeDirs = [
      app.getPath('home'),
      path.join('/Users'),
      path.join('/home'),
    ];

    return homeDirs.some(dir => {
      try {
        return fs.existsSync(dir) && resolved.startsWith(dir);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function coverExtFromMime(mime?: string): string {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg')) return 'jpg';
  return 'jpg';
}