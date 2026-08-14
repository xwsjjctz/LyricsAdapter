/**
 * 原子写入 JSON 文件（主进程专用）。
 *
 * 背景：直接 `fs.writeFileSync` 在写入过程中若发生崩溃/断电，会留下被截断的
 * 半份文件，随后 `JSON.parse` 抛错，调用方通常 catch 后返回空默认值 ——
 * 导致整个持久层（如 ~/.la/users.json、settings.json）静默丢失全部数据。
 *
 * 原子写部分委托给 write-file-atomic（临时文件 → fsync → rename，并自动处理
 * 异常清理与同名文件并发串行化）。
 *
 * 可选 keepBackup：rename 前把现有目标复制为 .bak，这样即使新写入后目标
 * 被损坏（极小概率，如 rename 后立即断电损坏元数据），load 时仍能从 .bak
 * 恢复上一次完整状态。copy 而非 rename，避免 rename 失败时目标丢失。
 * 这是 write-file-atomic 不提供的额外兜底，在此作为外层薄包装保留。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import writeFileAtomic from 'write-file-atomic';
import { logger } from '../logger';

// write-file-atomic v7 是纯 CJS 库，其 getTmpname 会读取 CJS 全局 __filename
// 来参与临时文件名哈希。本项目主进程是 ESM（package.json "type":"module" +
// vite 输出 .js），ESM 下不存在 __filename，运行时会抛 ReferenceError 导致
// 每次写盘失败。这里补上：打包后该值即 main.js 路径，对临时文件名唯一性无
// 影响（getTmpname 还混入了 pid + threadId + 递增计数器）。
// 仅在未定义时赋值，避免覆盖可能存在的真实值。
const g = globalThis as Record<string, unknown>;
if (typeof g['__filename'] === 'undefined') {
  try {
    g['__filename'] = fileURLToPath(import.meta.url);
  } catch {
    // 极端环境（import.meta.url 不可用）兜底用进程入口
    g['__filename'] = process.argv[1] ?? 'electron-main';
  }
}

interface AtomicWriteOptions {
  /** rename 前把现有目标复制为 `<filePath>.bak`，供 load 兜底恢复。默认 false。 */
  keepBackup?: boolean;
  /** Optional semantic validator used before rotating an existing primary. */
  validate?: (value: unknown) => boolean;
}

interface AtomicReadOptions {
  /** Reject syntactically valid JSON whose store schema is invalid. */
  validate?: (value: unknown) => boolean;
}

/**
 * 原子写入 JSON。写入失败会抛出异常（与 writeFileSync 一致），调用方自行 catch。
 */
export function writeJsonAtomic(filePath: string, data: unknown, options?: AtomicWriteOptions): void {
  if (options?.validate && !options.validate(data)) {
    throw new Error(`Refusing to write schema-invalid JSON to ${path.basename(filePath)}`);
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (options?.keepBackup && fs.existsSync(filePath)) {
    const bakPath = `${filePath}.bak`;
    try {
      // Never replace a known-good backup with a corrupt/truncated primary.
      // Parsing is cheap for these small JSON stores and closes the recovery
      // hole where the next failed write could otherwise destroy both copies.
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (options.validate && !options.validate(existing)) {
        throw new Error('Existing primary failed semantic validation');
      }
      fs.copyFileSync(filePath, bakPath);
    } catch (e) {
      // A backup failure must not block the atomic primary write. An existing
      // backup is deliberately left untouched.
      logger.warn(`[AtomicWrite] Skipped invalid/unreadable primary backup for ${path.basename(filePath)}:`, e);
    }
  }

  const json = JSON.stringify(data, null, 2);
  writeFileAtomic.sync(filePath, json);
}

/**
 * 读取 JSON 文件，主文件解析失败时回退到 `.bak`。
 *
 * @returns 解析后的对象；主文件与 .bak 都不可用时返回 null（调用方自行决定默认值）。
 */
export function readJsonWithBackup<T = unknown>(
  filePath: string,
  options?: AtomicReadOptions,
): { data: T; source: 'main' | 'backup' } | null {
  const tryRead = (p: string): T | null => {
    try {
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as T;
      if (options?.validate && !options.validate(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const main = tryRead(filePath);
  if (main !== null) return { data: main, source: 'main' };

  const backup = tryRead(`${filePath}.bak`);
  if (backup !== null) {
    logger.warn(`[AtomicWrite] ${path.basename(filePath)} corrupted/unreadable, recovered from .bak`);
    try {
      // Repair the primary without rotating the backup. If this repair fails,
      // callers can still use the in-memory backup data and the good .bak stays.
      writeFileAtomic.sync(filePath, JSON.stringify(backup, null, 2));
      logger.info(`[AtomicWrite] Repaired ${path.basename(filePath)} from .bak`);
    } catch (error) {
      logger.warn(`[AtomicWrite] Failed to repair ${path.basename(filePath)} from .bak:`, error);
    }
    return { data: backup, source: 'backup' };
  }

  return null;
}
