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
import { logger } from '../logger';

// ── Types ────────────────────────────────────────────────────────────────

export interface SyncedLyricLine {
  time: number;
  text: string;
}

export interface ReadMetadataResult {
  title: string | undefined;
  artist: string | undefined;
  album: string | undefined;
  lyrics: string | undefined;
  syncedLyrics: SyncedLyricLine[] | undefined;
  /** Duration in seconds (music-tag-native returns ms). */
  duration: number | undefined;
  bitRate: number | undefined;
  sampleRate: number | undefined;
  fileSize: number | undefined;
  /** Base64-encoded cover image data (no prefix). */
  coverData: string | undefined;
  coverMime: string | undefined;
}

export interface WriteMetadataInput {
  title: string | undefined;
  artist: string | undefined;
  album: string | undefined;
  lyrics: string | undefined;
  /** data: URI, cover:// URI, or http(s) URL. Base64 embedded URIs are
   *  decoded inline; cover:// URIs are read from the covers directory;
   *  http(s) URLs are downloaded. */
  coverDataUri: string | undefined;
}

// ── LRC parser ──
// 主进程与渲染层（src/shared/lrcParser.ts）逐字同步。因 vite 分包隔离无法直接
// import src/ 下的文件，故保留此副本。修改 src/shared/lrcParser.ts 时务必同步此处，
// 避免再次出现三份实现各自漂移、hh:mm:ss 解析不一致的回归（此前此处对
// [hh:mm:ss] 的解析是错的：把秒位当分钟 *60 且忽略了小时位）。

/** LRC metadata tags like [ti:Title], [ar:Artist] that should be filtered. */
const LRC_HEADER_TAG = /^\[(ti|ar|al|by|offset|re|ve|length|sign):/i;

/** LRC 时间戳：[mm:ss.xx]、[mm:ss]、或 [hh:mm:ss]。 */
const LRC_TIME_REGEX = /\[(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{2,3}))?\]/g;

function parseLRCLyrics(lrc: string): { plainText: string; syncedLyrics: SyncedLyricLine[] } {
  const lines = lrc.split(/\r?\n/);
  const syncedLyrics: SyncedLyricLine[] = [];
  const plainTextLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip LRC header metadata tags ([ti:…], [ar:…], etc.)
    if (LRC_HEADER_TAG.test(trimmed)) continue;

    const matches = [...trimmed.matchAll(LRC_TIME_REGEX)];
    const textWithoutTimestamps = trimmed.replace(LRC_TIME_REGEX, '').trim();

    if (textWithoutTimestamps === '//') continue;

    if (matches.length > 0 && textWithoutTimestamps) {
      for (const match of matches) {
        const minutes = parseInt(match[1]!, 10);
        const seconds = parseInt(match[2]!, 10);
        const hoursOrSeconds = match[3];
        const milliseconds = match[4] ? parseInt(match[4].padEnd(3, '0'), 10) : 0;

        let timeInSeconds: number;
        if (hoursOrSeconds) {
          // [hh:mm:ss] format: match[1]=hours, match[2]=minutes, match[3]=seconds
          const hours = minutes;
          const mins = seconds;
          const secs = parseInt(hoursOrSeconds, 10);
          timeInSeconds = hours * 3600 + mins * 60 + secs;
        } else {
          timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
        }

        syncedLyrics.push({ time: timeInSeconds, text: textWithoutTimestamps });
      }
      plainTextLines.push(trimmed);
    } else if (textWithoutTimestamps) {
      plainTextLines.push(trimmed);
    }
  }

  syncedLyrics.sort((a, b) => a.time - b.time);
  return { plainText: plainTextLines.join('\n'), syncedLyrics };
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

  const result: ReadMetadataResult = {
    title: file.title || undefined,
    artist: file.artist || undefined,
    album: file.album || undefined,
    lyrics: parsedLyrics?.plainText ?? rawLyrics,
    syncedLyrics: parsedLyrics?.syncedLyrics?.length ? parsedLyrics.syncedLyrics : undefined,
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
  logger.info('[AudioMetadata] ✓ Written:', filePath);
}

// ── Cover helpers ────────────────────────────────────────────────────────

async function resolveCover(uri: string): Promise<MetaPicture | null> {
  const dataUriMatch = uri.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1]!;
    const raw = Buffer.from(dataUriMatch[2]!, 'base64');
    return new MetaPicture(mimeType, new Uint8Array(raw));
  }

  if (uri.startsWith('cover://')) {
    const coverFileName = uri.slice('cover://'.length);
    const coverPath = path.join(app.getPath('userData'), 'covers', coverFileName);
    if (fs.existsSync(coverPath)) {
      const raw = fs.readFileSync(coverPath);
      const ext = path.extname(coverPath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
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

