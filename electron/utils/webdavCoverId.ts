import { createHash } from 'crypto';

/**
 * 封面文件 id 计算工具（零 electron 依赖）。
 *
 * 同时被主进程 IPC（electron/ipc/handlers.ts）和启动清理子进程（electron/cleanup.ts）
 * 引用——后者通过 `fork()` 拉起，不能 import electron，故本模块只依赖 node 内置 `crypto`。
 *
 * 算法必须与渲染端 services/webdavClient.ts 的 webdavCoverId / save-cover-thumbnail
 * 写盘逻辑保持一致，否则清理时会因 id 不匹配而误删 WebDAV 封面。
 */

/**
 * 把 trackId 中的非 [a-zA-Z0-9_-] 字符替换为 '_'，并截断到 64 字符。
 *
 * 纯移除（旧行为）会让不同路径碰撞（如 "/path1/file" 与 "/path/1file" → 都成 "path1file"），
 * 故改用替换。清洗后过短（<6）时回退到 sha1，避免极短 id 命中大量文件。
 */
export function sanitizeTrackId(trackId: string): string {
  const cleaned = trackId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  if (cleaned.length >= 6) {
    return cleaned;
  }
  return createHash('sha1').update(trackId).digest('hex');
}

/**
 * 计算 webdavPath 的稳定 hash 前缀（base36）。
 * 与渲染端 services/webdavClient.ts:webdavCoverId 使用同一 reduce 算法，保证两端一致。
 */
export function webdavPathHash(webdavPath: string): string {
  return Math.abs(
    [...webdavPath].reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)
  ).toString(36);
}

/**
 * 从 cloud trackId（形如 `webdav-<webdavPath>`）复现其封面文件的 id。
 *
 * 封面文件命名 = `webdavCoverId(webdavPath)` = `${pathHash}-${webdavPath}`，
 * 经 sanitizeTrackId 清洗后落盘（见 save-cover-thumbnail handler）。
 * 该前缀是 hash（数字），与 trackId 的 `webdav-` 字面前缀不同，清理孤儿封面时
 * 必须把这种命名也纳入活跃集，否则所有 WebDAV 封面会被误删。
 *
 * 入参不是 `webdav-` 前缀时返回 null（local track 的封面 id 即其 trackId，无需转换）。
 */
export function computeWebdavCoverId(trackId: string): string | null {
  if (!trackId.startsWith('webdav-')) return null;
  const webdavPath = trackId.slice('webdav-'.length);
  return sanitizeTrackId(`${webdavPathHash(webdavPath)}-${webdavPath}`);
}
