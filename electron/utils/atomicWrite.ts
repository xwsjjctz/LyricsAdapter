/**
 * 原子写入 JSON 文件（主进程专用）。
 *
 * 背景：直接 `fs.writeFileSync` 在写入过程中若发生崩溃/断电，会留下被截断的
 * 半份文件，随后 `JSON.parse` 抛错，调用方通常 catch 后返回空默认值 ——
 * 导致整个持久层（如 ~/.la/users.json、settings.json）静默丢失全部数据。
 *
 * 实现：写临时文件 → fsync 落盘 → rename 覆盖目标。rename 在同一文件系统
 * 上是原子的，要么完整生效、要么完全不生效，不会出现"半份"中间态。
 *
 * 可选 keepBackup：rename 前把现有目标复制为 .bak，这样即使新写入后目标
 * 被损坏（极小概率，如 rename 后立即断电损坏元数据），load 时仍能从 .bak
 * 恢复上一次完整状态。copy 而非 rename，避免 rename 失败时目标丢失。
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export interface AtomicWriteOptions {
  /** rename 前把现有目标复制为 `<filePath>.bak`，供 load 兜底恢复。默认 false。 */
  keepBackup?: boolean;
}

/**
 * 原子写入 JSON。写入失败会抛出异常（与 writeFileSync 一致），调用方自行 catch。
 */
export function writeJsonAtomic(filePath: string, data: unknown, options?: AtomicWriteOptions): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const json = JSON.stringify(data, null, 2);
  // 临时文件名带 pid + 随机串，避免并发写互相覆盖对方的临时文件。
  const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;

  let fd: number | undefined;
  try {
    // 'wx'：文件不存在时创建，存在则报错，避免复用残留临时文件。
    fd = fs.openSync(tmpPath, 'wx');
    fs.writeSync(fd, json, 0, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    if (options?.keepBackup && fs.existsSync(filePath)) {
      const bakPath = `${filePath}.bak`;
      try {
        fs.copyFileSync(filePath, bakPath);
      } catch (e) {
        // 备份失败不应阻塞主写入 —— 原文件至少会被新数据原子替换。
        logger.warn(`[AtomicWrite] Failed to create .bak for ${path.basename(filePath)}:`, e);
      }
    }

    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    // 清理残留临时文件，避免堆积
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closing */ }
    }
    try { fs.unlinkSync(tmpPath); } catch { /* may not exist */ }
    throw e;
  }
}

/**
 * 读取 JSON 文件，主文件解析失败时回退到 `.bak`。
 *
 * @returns 解析后的对象；主文件与 .bak 都不可用时返回 null（调用方自行决定默认值）。
 */
export function readJsonWithBackup<T = unknown>(filePath: string): { data: T; source: 'main' | 'backup' } | null {
  const tryRead = (p: string): T | null => {
    try {
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const main = tryRead(filePath);
  if (main !== null) return { data: main, source: 'main' };

  const backup = tryRead(`${filePath}.bak`);
  if (backup !== null) {
    logger.warn(`[AtomicWrite] ${path.basename(filePath)} corrupted/unreadable, recovered from .bak`);
    return { data: backup, source: 'backup' };
  }

  return null;
}
