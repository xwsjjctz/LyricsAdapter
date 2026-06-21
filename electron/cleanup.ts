import fs from 'fs';
import path from 'path';

function sanitizeTrackId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * 计算与 migrateCoverToDisk 一致的封面文件 ID（含 pathHash 前缀）。
 * 封面文件使用 `${pathHash}-${webdavPath}` 命名（而非 track ID 的 `webdav-` 前缀），
 * 清理时必须把这种命名也纳入活跃集，否则所有 WebDAV 封面会被误删。
 */
function computeCoverId(trackId: string): string | null {
  if (!trackId.startsWith('webdav-')) return null;
  const webdavPath = trackId.slice('webdav-'.length);
  const pathHash = Math.abs(
    [...webdavPath].reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)
  ).toString(36);
  return sanitizeTrackId(`${pathHash}-${webdavPath}`);
}

function runCleanup(userDataPath: string, activeTrackIds: string[]): void {
  const results = {
    coversRemoved: 0,
    audioDirDeleted: false,
    libraryJsonDeleted: false,
    errors: [] as string[]
  };

  if (activeTrackIds.length === 0) {
    console.log('[Cleanup] No active tracks, skipping covers cleanup to prevent accidental deletion');
  } else {
    const activeSet = new Set<string>();
    for (const id of activeTrackIds) {
      activeSet.add(sanitizeTrackId(id));
      // WebDAV 封面文件名含 pathHash 前缀，也加入匹配集
      const coverId = computeCoverId(id);
      if (coverId) activeSet.add(coverId);
    }
    const coversDir = path.join(userDataPath, 'covers');

    if (fs.existsSync(coversDir)) {
      try {
        const files = fs.readdirSync(coversDir);
        for (const file of files) {
          const trackId = file.replace(/\.(jpg|jpeg|png|webp)$/i, '');
          if (!activeSet.has(trackId)) {
            try {
              fs.unlinkSync(path.join(coversDir, file));
              results.coversRemoved++;
            } catch (e) {
              results.errors.push(`Failed to delete cover ${file}: ${(e as Error).message}`);
            }
          }
        }
      } catch (e) {
        results.errors.push(`Failed to read covers directory: ${(e as Error).message}`);
      }
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
