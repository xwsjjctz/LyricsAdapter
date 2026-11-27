import fs from 'fs';
import path from 'path';
import { isImportableAudioName, type AudioPathScan } from '../../src/shared/audioFormats';
import { logger } from '../logger';

/** Bounds that keep a mistaken pick, such as a home folder or a whole disk, from running away. */
export const AUDIO_SCAN_LIMITS = { files: 20_000, directories: 50_000 } as const;

export interface AudioScanLimits {
  files: number;
  directories: number;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Hidden entries include macOS `._Song.mp3` AppleDouble files, which carry no audio. */
function isHidden(name: string): boolean {
  return name.startsWith('.');
}

/**
 * Lists the importable audio under `roots`, which may be files or folders.
 * Folders are walked depth-first in name order, a folder's own files before its
 * sub-folders, so albums stay together and discs follow each other. Symbolic
 * links inside a folder are skipped, which also rules out cycles. Unreadable
 * entries are logged and skipped rather than failing the whole scan.
 */
export async function collectImportableAudio(
  roots: readonly string[],
  limits: AudioScanLimits = AUDIO_SCAN_LIMITS,
): Promise<AudioPathScan> {
  const found = new Set<string>();
  const visited = new Set<string>();
  let truncated = false;

  const addFile = (filePath: string): void => {
    if (found.has(filePath)) return;
    if (found.size >= limits.files) {
      truncated = true;
      return;
    }
    found.add(filePath);
  };

  const walk = async (directory: string): Promise<void> => {
    if (truncated || visited.has(directory)) return;
    if (visited.size >= limits.directories) {
      truncated = true;
      return;
    }
    visited.add(directory);

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      logger.warn('[AudioScan] Cannot read folder:', directory, error);
      return;
    }
    const visible = entries
      .filter(entry => !isHidden(entry.name))
      .sort((first, second) => byName.compare(first.name, second.name));

    for (const entry of visible) {
      if (truncated) return;
      if (entry.isFile() && isImportableAudioName(entry.name)) addFile(path.join(directory, entry.name));
    }
    for (const entry of visible) {
      if (truncated) return;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name));
    }
  };

  for (const root of roots) {
    if (truncated) break;
    const resolved = path.resolve(root);
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(resolved);
    } catch (error) {
      logger.warn('[AudioScan] Cannot read:', resolved, error);
      continue;
    }
    if (stats.isDirectory()) {
      await walk(resolved);
    } else if (stats.isFile() && !isHidden(path.basename(resolved)) && isImportableAudioName(resolved)) {
      addFile(resolved);
    }
  }

  if (truncated) {
    logger.warn(`[AudioScan] Stopped at a scan limit: ${found.size} files, ${visited.size} folders`);
  }
  return { filePaths: [...found], truncated };
}
