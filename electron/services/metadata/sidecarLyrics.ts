import fs from 'fs';
import path from 'path';
import { logger } from '../../logger';

/** A lyric file is a few kilobytes; anything far larger is not one. */
const SIDECAR_MAX_BYTES = 512 * 1024;
const SIDECAR_EXTENSIONS = ['.lrc', '.LRC'] as const;

/**
 * Decodes a lyric file. Most are UTF-8, but older collections of Chinese music
 * carry GBK files without any marker, so bytes that are not valid UTF-8 are
 * read as GB18030 (a superset of GBK).
 */
export function decodeLyricsFile(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

/**
 * Lyrics kept beside an audio file under the same name, such as `Song.lrc`
 * next to `Song.flac`. Undefined when there is no such file or it is empty.
 */
export function readSidecarLyrics(audioPath: string): string | undefined {
  const base = audioPath.slice(0, audioPath.length - path.extname(audioPath).length);
  for (const extension of SIDECAR_EXTENSIONS) {
    const candidate = base + extension;
    try {
      const stats = fs.statSync(candidate);
      if (!stats.isFile() || stats.size === 0 || stats.size > SIDECAR_MAX_BYTES) continue;
      const text = decodeLyricsFile(fs.readFileSync(candidate)).trim();
      if (text) return text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[SidecarLyrics] Cannot read lyric file:', candidate, error);
      }
    }
  }
  return undefined;
}
