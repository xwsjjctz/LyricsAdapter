/**
 * Audio Metadata Service — unified wrapper around music-tag-native.
 *
 * Replaces the hand-parsed binary readers in metadataWorker.ts and
 * coverArtService.ts (renderer), and the former custom writers that
 * lived in electron/utils/metadataUtils.ts (now removed).
 *
 * Uses the native napi-rs binding (MusicFile) for Node.js — runs in
 * the Electron main process so there is no IPC overhead per file.
 */
import { MusicFile, MetaPicture } from 'music-tag-native';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { parseLrc, parseQrc, parseYrc, type LyricLine } from '@applemusic-like-lyrics/lyric';
import { readWordLyrics, writeWordLyrics } from './wordLyricsTagService';
import { logger } from '../logger';

// ── Types ────────────────────────────────────────────────────────────────

export interface SyncedLyricLine {
  time: number;
  text: string;
  /** Per-word karaoke timing, present only for QRC/YRC word-by-word lyrics. */
  words?: SyncedLyricWord[];
}

export interface SyncedLyricWord {
  time: number;
  duration: number;
  text: string;
}

export type WordLyricsFormat = 'qrc' | 'yrc';

interface ReadMetadataResult {
  title: string | undefined;
  artist: string | undefined;
  album: string | undefined;
  lyrics: string | undefined;
  syncedLyrics: SyncedLyricLine[] | undefined;
  /** Raw QRC/YRC payload persisted as a custom tag, for re-parse on re-import. */
  wordLyrics: string | undefined;
  wordLyricsFormat: WordLyricsFormat | undefined;
  /** Duration in seconds (music-tag-native returns ms). */
  duration: number | undefined;
  bitRate: number | undefined;
  sampleRate: number | undefined;
  fileSize: number | undefined;
  /** Base64-encoded cover image data (no prefix). */
  coverData: string | undefined;
  coverMime: string | undefined;
}

interface WriteMetadataInput {
  title: string | undefined;
  artist: string | undefined;
  album: string | undefined;
  lyrics: string | undefined;
  /** Raw QRC/YRC payload to persist as a custom `QRC`/`YRC` field (FLAC) or
   *  `TXXX:QRC`/`TXXX:YRC` frame (MP3). No-op on unsupported formats (m4a). */
  wordLyrics: string | undefined;
  wordLyricsFormat: WordLyricsFormat | undefined;
  /** data: URI, cover:// URI, or http(s) URL. Base64 embedded URIs are
   *  decoded inline; cover:// URIs are read from the covers directory;
   *  http(s) URLs are downloaded. */
  coverDataUri: string | undefined;
}

// ── AMLL parser adapter ──
// Main and renderer builds cannot share the same bundle module, but both keep
// AMLL as the sole parser and only adapt its millisecond output for persistence.

/** LRC metadata tags like [ti:Title], [ar:Artist] that should be filtered. */
const LRC_HEADER_TAG = /^\[(ti|ar|al|by|offset|re|ve|length|sign):/i;

function parseLRCLyrics(lrc: string): { plainText: string; syncedLyrics: SyncedLyricLine[] } {
  const syncedLyrics = parseLrc(lrc)
    .map((line) => ({
      time: line.startTime / 1000,
      text: line.words.map((word) => word.word).join(''),
    }))
    .filter((line) => Number.isFinite(line.time) && Boolean(line.text));
  return {
    plainText: syncedLyrics.length > 0
      ? syncedLyrics.map((line) => line.text).join('\n')
      : plainLyricsText(lrc),
    syncedLyrics,
  };
}

function plainLyricsText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !LRC_HEADER_TAG.test(line))
    .join('\n');
}

// ── QRC / YRC parsers ──
// 主进程副本，与 src/shared/lrcParser.ts 的 parseLyrics/extractQrcContent/
// fromAmlLines 保持逐字同步（同样因 vite 分包隔离无法 import src/）。修改
// src/shared/lrcParser.ts 时务必同步此处。QRC/YRC 仅从已持久化的自定义标签
// 读回时用到，用于恢复逐字歌词；在线获取的逐字歌词在渲染层解析。

/** Pull the `LyricContent="..."` payload out of a decrypted QRC XML document. */
function extractQrcContent(raw: string): string {
  // Mirror of src/shared/lrcParser.ts: the attribute value may contain
  // apostrophes from the lyrics themselves, so anchor on the terminating `"/>`
  // rather than a `["']` delimiter (which would truncate at the first quote).
  const lyricContent = raw.match(/LyricContent\s*=\s*"([\s\S]*?)"\s*\/>/i)?.[1];
  return decodeXml(lyricContent ?? raw);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/** Map AMLL LyricLine[] to our synced lines, optionally carrying per-word timing. */
function fromAmlLines(lines: LyricLine[], fallbackText: string, includeWordTiming: boolean): {
  plainText: string;
  syncedLyrics: SyncedLyricLine[];
} {
  const syncedLyrics = lines
    .filter((line) => line.words.some((word) => word.word.trim()))
    .map((line) => {
      const text = line.words.map((word) => word.word).join('');
      const words = includeWordTiming
        ? line.words
          .filter((word) => word.word && Number.isFinite(word.startTime) && Number.isFinite(word.endTime))
          .map((word) => ({
            time: word.startTime / 1000,
            duration: Math.max(0, (word.endTime - word.startTime) / 1000),
            text: word.word,
          }))
          .filter((word) => word.duration > 0)
        : [];
      return {
        time: line.startTime / 1000,
        text,
        ...(words.length > 0 ? { words } : {}),
      };
    })
    .filter((line) => Number.isFinite(line.time) && line.text);

  return {
    plainText: syncedLyrics.length > 0
      ? syncedLyrics.map((line) => line.text).join('\n')
      : plainLyricsText(fallbackText),
    syncedLyrics,
  };
}

/**
 * Parse a word-lyrics payload (QRC or YRC) into per-word synced lines.
 * Returns undefined when the payload is missing or yields no word timing —
 * callers then fall back to LRC parsing.
 */
function parseWordLyrics(
  wordLyrics: string,
  format: WordLyricsFormat,
): { plainText: string; syncedLyrics: SyncedLyricLine[] } | undefined {
  try {
    const amlLines = format === 'qrc'
      ? parseQrc(extractQrcContent(wordLyrics))
      : parseYrc(wordLyrics);
    const parsed = fromAmlLines(amlLines, wordLyrics, true);
    if (!parsed.syncedLyrics.some((line) => line.words?.length)) return undefined;
    return parsed;
  } catch (e) {
    logger.warn(`[AudioMetadata] Failed to parse ${format} payload:`, e);
    return undefined;
  }
}

// ── Read ─────────────────────────────────────────────────────────────────

export async function readAudioMetadata(filePath: string): Promise<ReadMetadataResult> {
  logger.info('[AudioMetadata] Reading:', filePath);

  const stats = fs.statSync(filePath);
  const fileSize = stats.size;

  const file = await MusicFile.load(path.resolve(filePath));

  let coverData: string | undefined;
  let coverMime: string | undefined;
  if (file.pictures && file.pictures.length > 0 && file.pictures[0]) {
    const pic = file.pictures[0];
    coverMime = pic.mimeType || 'image/jpeg';
    coverData = Buffer.from(pic.data).toString('base64');
  }

  const rawLyrics = file.lyrics || undefined;
  const parsedLyrics = rawLyrics ? parseLRCLyrics(rawLyrics) : null;

  // QRC/YRC live in custom fields music-tag-native can't read; pull them via
  // our own FLAC/MP3 readers. When present they carry the richer per-word
  // timing AND — critically — a complete time axis, so they take precedence
  // over the line-level LRC fallback even for line-only rendering. This is
  // what restores both 逐字 and 逐行 for the QQ tracks whose LRC came back
  // timestamp-less (their QRC payload still has full timings).
  const { wordLyrics, wordLyricsFormat } = readWordLyrics(filePath);
  const parsedWordLyrics = wordLyrics && wordLyricsFormat
    ? parseWordLyrics(wordLyrics, wordLyricsFormat)
    : undefined;

  const result: ReadMetadataResult = {
    title: file.title || undefined,
    artist: file.artist || undefined,
    album: file.album || undefined,
    lyrics: parsedWordLyrics?.plainText ?? parsedLyrics?.plainText ?? rawLyrics,
    syncedLyrics: parsedWordLyrics?.syncedLyrics?.length
      ? parsedWordLyrics.syncedLyrics
      : parsedLyrics?.syncedLyrics?.length ? parsedLyrics.syncedLyrics : undefined,
    wordLyrics,
    wordLyricsFormat,
    duration: file.duration != null ? file.duration / 1000 : undefined,
    bitRate: file.bitRate ?? undefined,
    sampleRate: file.sampleRate ?? undefined,
    fileSize,
    coverData,
    coverMime,
  };

  const logSafe = { ...result, coverData: result.coverData ? `base64:${(result.coverData.length / 1024).toFixed(1)}KB` : undefined };
  logger.info('[AudioMetadata] ✓ Read:', filePath, JSON.stringify(logSafe, null, 2));
  return result;
}

// ── Write ────────────────────────────────────────────────────────────────

export async function writeAudioMetadata(
  filePath: string,
  metadata: WriteMetadataInput,
): Promise<void> {
  logger.info('[AudioMetadata] Writing:', filePath, JSON.stringify(metadata));

  const resolved = path.resolve(filePath);
  const file = await MusicFile.load(resolved);

  if (metadata.title !== undefined) file.title = metadata.title;
  if (metadata.artist !== undefined) file.artist = metadata.artist;
  if (metadata.album !== undefined) file.album = metadata.album;
  if (metadata.lyrics !== undefined) file.lyrics = metadata.lyrics;

  if (metadata.coverDataUri !== undefined) {
    if (metadata.coverDataUri === '') {
      // Remove cover
      file.pictures = null;
    } else {
      const picture = await resolveCover(metadata.coverDataUri);
      if (picture) {
        file.pictures = [picture];
      }
    }
  }

  await file.save();

  // Persist QRC/YRC into the custom tag *after* the main tag write so a
  // failure here never undoes title/artist/album/lyrics/cover. writeWordLyrics
  // swallows errors itself; we just log success.
  if (metadata.wordLyrics !== undefined && metadata.wordLyricsFormat) {
    writeWordLyrics(resolved, metadata.wordLyrics, metadata.wordLyricsFormat);
  }

  logger.info('[AudioMetadata] ✓ Written:', filePath);
}

// ── Cover helpers ────────────────────────────────────────────────────────

/** Extract the flat source filename from raw or content-versioned cover URLs. */
export function coverFileNameFromUri(uri: string): string | null {
  if (!uri.startsWith('cover://')) return null;
  const reference = uri.slice('cover://'.length).split(/[?#]/, 1)[0];
  if (!reference) return null;

  try {
    const decoded = decodeURIComponent(reference);
    if (!/^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(decoded)
      || decoded.includes('/')
      || decoded.includes('\\')) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function resolveCover(uri: string): Promise<MetaPicture | null> {
  const dataUriMatch = uri.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1]!;
    const raw = Buffer.from(dataUriMatch[2]!, 'base64');
    return new MetaPicture(mimeType, new Uint8Array(raw));
  }

  if (uri.startsWith('cover://')) {
    const coverFileName = coverFileNameFromUri(uri);
    if (!coverFileName) {
      logger.warn('[AudioMetadata] Invalid cover URI:', uri);
      return null;
    }
    const coverPath = path.join(app.getPath('userData'), 'covers', coverFileName);
    if (fs.existsSync(coverPath)) {
      const raw = fs.readFileSync(coverPath);
      const ext = path.extname(coverPath).toLowerCase();
      const mimeType = ext === '.png'
        ? 'image/png'
        : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return new MetaPicture(mimeType, new Uint8Array(raw));
    }
    logger.warn('[AudioMetadata] Cover file not found:', coverPath);
    return null;
  }

  // http(s) URL — download
  try {
    const resp = await fetch(uri, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://y.qq.com/',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') || 'image/jpeg';
    return new MetaPicture(mimeType, new Uint8Array(buf));
  } catch (e) {
    logger.error('[AudioMetadata] Failed to download cover:', e);
    return null;
  }
}
