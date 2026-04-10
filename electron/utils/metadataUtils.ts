import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import NodeID3 from 'node-id3';
import { logger } from '../logger';
import { getBundledBinaryPath, getBinaryPath, runCommand } from './binaryUtils';
import { expandHomeDir, detectFileFormat } from './fileUtils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function escapeFfmetadataValue(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const escapedLines = normalized
    .split('\n')
    .map(line => line
      .replace(/\\/g, '\\\\')
      .replace(/=/g, '\\=')
      .replace(/;/g, '\\;')
      .replace(/#/g, '\\#'));

  return escapedLines.join('\\\n');
}

export function buildFfmetadataContent(metadata: {
  title?: string;
  artist?: string;
  album?: string;
  lyrics?: string;
}): string {
  const lines = [';FFMETADATA1'];
  if (metadata.title) lines.push(`TITLE=${escapeFfmetadataValue(metadata.title)}`);
  if (metadata.artist) lines.push(`ARTIST=${escapeFfmetadataValue(metadata.artist)}`);
  if (metadata.album) lines.push(`ALBUM=${escapeFfmetadataValue(metadata.album)}`);
  if (metadata.lyrics) {
    const escapedLyrics = escapeFfmetadataValue(metadata.lyrics);
    lines.push(`LYRICS=${escapedLyrics}`);
    lines.push(`UNSYNCEDLYRICS=${escapedLyrics}`);
    lines.push(`LYRIC=${escapedLyrics}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function createVorbisComment(comments: string[]): Buffer {
  const vendor = 'LyricsAdapter';
  const vendorBuffer = Buffer.from(vendor, 'utf-8');

  const vendorLen = Buffer.alloc(4);
  vendorLen.writeUInt32LE(vendorBuffer.length, 0);

  const commentDataBuffers: Buffer[] = [];
  for (const comment of comments) {
    const commentBuffer = Buffer.from(comment, 'utf-8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(commentBuffer.length, 0);
    commentDataBuffers.push(Buffer.concat([lenBuf, commentBuffer]));
  }

  const countBuffer = Buffer.alloc(4);
  countBuffer.writeUInt32LE(comments.length, 0);

  const commentsData = Buffer.concat([
    vendorLen,
    vendorBuffer,
    countBuffer,
    ...commentDataBuffers
  ]);

  const header = Buffer.alloc(4);
  header[0] = 4;
  header.writeUIntBE(commentsData.length, 1, 3);

  return Buffer.concat([header, commentsData]);
}

export function createPictureBlock(imageBuffer: Buffer): Buffer {
  const pictureType = Buffer.alloc(4);
  pictureType.writeUInt32BE(3, 0);

  const mimeStr = 'image/jpeg';
  const mimeLen = Buffer.alloc(4);
  mimeLen.writeUInt32BE(mimeStr.length, 0);
  const mimeBuffer = Buffer.from(mimeStr, 'utf-8');

  const descLen = Buffer.alloc(4);
  descLen.writeUInt32BE(0, 0);

  const width = Buffer.alloc(4);
  width.writeUInt32BE(0, 0);
  const height = Buffer.alloc(4);
  height.writeUInt32BE(0, 0);
  const depth = Buffer.alloc(4);
  depth.writeUInt32BE(0, 0);
  const colors = Buffer.alloc(4);
  colors.writeUInt32BE(0, 0);

  const picDataLen = Buffer.alloc(4);
  picDataLen.writeUInt32BE(imageBuffer.length, 0);

  const pictureData = Buffer.concat([
    pictureType,
    mimeLen,
    mimeBuffer,
    descLen,
    width,
    height,
    depth,
    colors,
    picDataLen,
    imageBuffer
  ]);

  const header = Buffer.alloc(4);
  header[0] = 6;
  header.writeUIntBE(pictureData.length, 1, 3);

  return Buffer.concat([header, pictureData]);
}

export async function writeFlacMetadata(
  filePath: string,
  metadata: { title?: string; artist?: string; album?: string; lyrics?: string; coverUrl?: string },
  coverBuffer?: Buffer
): Promise<boolean> {
  const backupPath = filePath + '.backup';
  const logFile = path.join(app.getPath('userData'), 'flac-metadata.log');

  const log = (message: string) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    logger.info(message);
    try {
      fs.appendFileSync(logFile, logLine);
    } catch (e) {
      // Ignore log errors
    }
  };

  try {
    log(`[FLAC] Starting metadata write for: ${filePath}`);
    log(`[FLAC] Metadata: ${JSON.stringify(metadata)}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    log(`[FLAC] Creating backup: ${backupPath}`);
    fs.copyFileSync(filePath, backupPath);

    const fileData = fs.readFileSync(filePath);
    log(`[FLAC] Original file size: ${fileData.length} bytes`);
    log(`[FLAC] First 4 bytes: ${fileData.slice(0, 4).toString('hex')} (${fileData.slice(0, 4).toString()})`);

    if (fileData[0] !== 0x66 || fileData[1] !== 0x4C || fileData[2] !== 0x61 || fileData[3] !== 0x43) {
      throw new Error('Not a valid FLAC file');
    }

    let pos = 4;

    const keptBlocks: Buffer[] = [];
    let isLastBlock = false;
    let blockCount = 0;

    while (!isLastBlock && pos < fileData.length - 4) {
      const blockHeader = fileData[pos];
      isLastBlock = (blockHeader & 0x80) !== 0;
      const blockType = blockHeader & 0x7F;
      const blockLength = (fileData[pos + 1] << 16) | (fileData[pos + 2] << 8) | fileData[pos + 3];

      log(`[FLAC] Block ${blockCount}: type=${blockType}, length=${blockLength}, isLast=${isLastBlock}`);

      if (blockType !== 4 && blockType !== 6) {
        keptBlocks.push(fileData.slice(pos, pos + 4 + blockLength));
        log(`[FLAC]   -> Keeping block`);
      } else {
        log(`[FLAC]   -> Skipping block (will replace)`);
      }

      pos += 4 + blockLength;
      blockCount++;
    }

    const audioDataStart = pos;
    log(`[FLAC] Audio data starts at offset: ${audioDataStart}`);
    log(`[FLAC] Kept ${keptBlocks.length} blocks`);

    const newBlocks: Buffer[] = [];

    for (let i = 0; i < keptBlocks.length; i++) {
      const block = keptBlocks[i];
      const modified = Buffer.from(block);
      modified[0] &= 0x7F;
      newBlocks.push(modified);
    }

    const comments: string[] = [];
    if (metadata.title) comments.push(`TITLE=${metadata.title}`);
    if (metadata.artist) comments.push(`ARTIST=${metadata.artist}`);
    if (metadata.album) comments.push(`ALBUM=${metadata.album}`);
    if (metadata.lyrics) {
      log(`[FLAC] Adding lyrics, length: ${metadata.lyrics.length}`);
      comments.push(`LYRICS=${metadata.lyrics}`);
    }

    if (comments.length > 0) {
      const vorbisComment = createVorbisComment(comments);
      log(`[FLAC] Created VORBIS_COMMENT block, size: ${vorbisComment.length} bytes`);
      newBlocks.push(vorbisComment);
    }

    if (coverBuffer) {
      const pictureBlock = createPictureBlock(coverBuffer);
      log(`[FLAC] Created PICTURE block, size: ${pictureBlock.length} bytes`);
      newBlocks.push(pictureBlock);
    }

    if (newBlocks.length > 0) {
      const lastBlock = newBlocks[newBlocks.length - 1];
      const modifiedLast = Buffer.from(lastBlock);
      modifiedLast[0] |= 0x80;
      newBlocks[newBlocks.length - 1] = modifiedLast;
    }

    log(`[FLAC] Total blocks after processing: ${newBlocks.length}`);

    const metadataBytes = Buffer.concat(newBlocks);
    const audioData = fileData.slice(audioDataStart);
    const result = Buffer.concat([fileData.slice(0, 4), metadataBytes, audioData]);

    log(`[FLAC] New file size: ${result.length} bytes (original: ${fileData.length})`);
    log(`[FLAC] Size change: ${result.length - fileData.length} bytes`);

    const tempPath = filePath + '.tmp';
    log(`[FLAC] Writing to temp file: ${tempPath}`);
    fs.writeFileSync(tempPath, result);

    const verifyData = fs.readFileSync(tempPath);
    log(`[FLAC] Temp file size: ${verifyData.length} bytes`);

    log(`[FLAC] Replacing original file`);
    fs.renameSync(tempPath, filePath);

    log(`[FLAC] Success, removing backup`);
    fs.unlinkSync(backupPath);

    log('[FLAC] ✓ Metadata written successfully');
    return true;
  } catch (e) {
    log(`[FLAC] ✗ Error: ${(e as Error).message}`);
    log(`[FLAC] Stack: ${(e as Error).stack}`);

    if (fs.existsSync(backupPath)) {
      log(`[FLAC] Restoring from backup`);
      try {
        fs.copyFileSync(backupPath, filePath);
        fs.unlinkSync(backupPath);
        log(`[FLAC] ✓ Backup restored`);
      } catch (restoreError) {
        log(`[FLAC] ✗ Failed to restore backup: ${restoreError}`);
      }
    }

    throw e;
  }
}

async function writeFlacMetadataWithFfmpeg(
  filePath: string,
  metadata: { title?: string; artist?: string; album?: string; lyrics?: string },
  coverBuffer?: Buffer
): Promise<boolean> {
  const appDir = __dirname;
  const ffmpegBinary = getBinaryPath('ffmpeg', appDir);
  const backupPath = `${filePath}.ffmpeg.backup`;
  const metadataPath = `${filePath}.ffmetadata.txt`;
  const coverPath = `${filePath}.cover.ffmpeg.jpg`;
  const outputPath = `${filePath}.ffmpeg.tmp.flac`;

  try {
    logger.info('[FFMPEG] Starting FLAC remux metadata write for:', filePath);
    logger.info('[FFMPEG] FFmpeg binary path:', ffmpegBinary);
    logger.info('[FFMPEG] Metadata to write:', JSON.stringify(metadata, null, 2));
    logger.info('[FFMPEG] Cover buffer present:', !!coverBuffer, 'Size:', coverBuffer?.length || 0);
    fs.copyFileSync(filePath, backupPath);
    fs.writeFileSync(metadataPath, buildFfmetadataContent(metadata), 'utf-8');
    if (coverBuffer && coverBuffer.length > 0) {
      fs.writeFileSync(coverPath, coverBuffer);
    }

    const hasCover = !!(coverBuffer && coverBuffer.length > 0);
    const metadataInputIndex = hasCover ? '2' : '1';
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      filePath,
    ];

    if (hasCover) {
      args.push('-i', coverPath);
    }

    args.push(
      '-f',
      'ffmetadata',
      '-i',
      metadataPath,
      '-map',
      '0:a:0'
    );

    if (hasCover) {
      args.push('-map', '1:v:0');
    }

    args.push(
      '-map_metadata',
      '-1',
      '-map_metadata',
      metadataInputIndex,
      '-c:a',
      'copy'
    );

    if (hasCover) {
      args.push('-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    }

    args.push(outputPath);

    logger.info('[FFMPEG] Executing command:', ffmpegBinary, args.join(' '));
    logger.info('[FFMPEG] Metadata file content:', fs.readFileSync(metadataPath, 'utf-8'));

    await runCommand(ffmpegBinary, args);

    const outputStats = fs.statSync(outputPath);
    if (!outputStats.size) {
      throw new Error('ffmpeg produced empty output file');
    }

    fs.copyFileSync(outputPath, filePath);
    fs.unlinkSync(backupPath);
    logger.info('[FFMPEG] ✓ FLAC metadata remux completed');
    return true;
  } catch (error) {
    logger.error('[FFMPEG] FLAC metadata remux failed:', error);
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, filePath);
    }
    throw error;
  } finally {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);
    if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  }
}

async function writeFlacMetadataWithMetaflac(
  filePath: string,
  metadata: { title?: string; artist?: string; album?: string; lyrics?: string; coverUrl?: string }
): Promise<boolean> {
  const logFile = path.join(app.getPath('userData'), 'flac-metadata.log');
  const appDir = __dirname;
  const metaflacBinary = getBinaryPath('metaflac', appDir);

  const execOptions = {
    encoding: 'utf-8' as const,
    stdio: 'pipe' as const,
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8'
    }
  };

  const log = (message: string) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    logger.info(message);
    try {
      fs.appendFileSync(logFile, logLine);
    } catch (e) {
      // Ignore log errors
    }
  };

  try {
    log(`[METAFLAC] Starting metadata write for: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const backupPath = filePath + '.backup';
    log(`[METAFLAC] Creating backup: ${backupPath}`);
    fs.copyFileSync(filePath, backupPath);

    let existingCoverPath: string | undefined;
    if (!metadata.coverUrl) {
      try {
        existingCoverPath = filePath + '.existing_cover.jpg';
        log(`[METAFLAC] Extracting existing cover to: ${existingCoverPath}`);
        execSync(`"${metaflacBinary}" --export-picture-to="${existingCoverPath}" "${filePath}"`, execOptions);
        if (fs.existsSync(existingCoverPath)) {
          const stats = fs.statSync(existingCoverPath);
          log(`[METAFLAC] ✓ Existing cover extracted (${stats.size} bytes)`);
        } else {
          existingCoverPath = undefined;
          log(`[METAFLAC] No existing cover found`);
        }
      } catch (e: any) {
        existingCoverPath = undefined;
        log(`[METAFLAC] Warning: Failed to extract existing cover: ${e.message}`);
      }
    }

    log(`[METAFLAC] Removing existing metadata`);
    try {
      execSync(`"${metaflacBinary}" --remove-all-tags "${filePath}"`, execOptions);
      execSync(`"${metaflacBinary}" --remove --block-type=PICTURE "${filePath}"`, execOptions);
    } catch (e: any) {
      log(`[METAFLAC] Warning during removal: ${e.message}`);
    }

    const tags: { field: string; value: string }[] = [];
    if (metadata.title) tags.push({ field: 'TITLE', value: metadata.title });
    if (metadata.artist) tags.push({ field: 'ARTIST', value: metadata.artist });
    if (metadata.album && metadata.album.trim()) tags.push({ field: 'ALBUM', value: metadata.album });

    if (tags.length > 0) {
      log(`[METAFLAC] Writing ${tags.length} tags: ${tags.map(t => t.field).join(', ')}`);
      log(`[METAFLAC] Metadata: ${JSON.stringify(metadata)}`);

      for (const tag of tags) {
        try {
          const tagFile = filePath + `.${tag.field}.txt`;
          fs.writeFileSync(tagFile, tag.value, 'utf-8');
          execSync(`"${metaflacBinary}" --set-tag-from-file="${tag.field}=${tagFile}" "${filePath}"`, execOptions);
          log(`[METAFLAC] ✓ Set ${tag.field}=${tag.value.substring(0, 30)}${tag.value.length > 30 ? '...' : ''}`);
          fs.unlinkSync(tagFile);
        } catch (e: any) {
          log(`[METAFLAC] Warning: Failed to set ${tag.field}: ${e.message}`);
        }
      }
      log(`[METAFLAC] ✓ All tags written`);
    }

    if (metadata.lyrics) {
      try {
        const lyricsFile = filePath + '.lyrics.txt';
        fs.writeFileSync(lyricsFile, metadata.lyrics, 'utf-8');
        execSync(`"${metaflacBinary}" --set-tag-from-file="LYRICS=${lyricsFile}" "${filePath}"`, execOptions);
        fs.unlinkSync(lyricsFile);
        log(`[METAFLAC] ✓ Lyrics written (${metadata.lyrics.length} chars)`);
      } catch (e: any) {
        log(`[METAFLAC] Warning: Failed to write lyrics: ${e.message}`);
      }
    }

    if (metadata.coverUrl) {
      try {
        let coverFile = filePath + '.cover.jpg';
        let coverBuf: Buffer | undefined;

        if (metadata.coverUrl.startsWith('data:')) {
          log(`[METAFLAC] Parsing data URL cover`);
          const matches = metadata.coverUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches && matches[2]) {
            coverBuf = Buffer.from(matches[2], 'base64');
          }
        } else if (metadata.coverUrl.startsWith('cover://')) {
          const coverFileName = metadata.coverUrl.slice('cover://'.length);
          const coverPathLoc = path.join(app.getPath('userData'), 'covers', coverFileName);
          log(`[METAFLAC] Reading cover from local path: ${coverPathLoc}`);
          if (fs.existsSync(coverPathLoc)) {
            coverBuf = fs.readFileSync(coverPathLoc);
          } else {
            log(`[METAFLAC] Warning: Cover file not found: ${coverPathLoc}`);
          }
        } else {
          log(`[METAFLAC] Downloading cover from: ${metadata.coverUrl}`);
          const response = await fetch(metadata.coverUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
              'Referer': 'https://y.qq.com/',
            },
          });
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            coverBuf = Buffer.from(arrayBuffer);
          }
        }

        if (coverBuf) {
          fs.writeFileSync(coverFile, coverBuf);
          log(`[METAFLAC] Cover prepared (${coverBuf.length} bytes)`);
          execSync(`"${metaflacBinary}" --import-picture-from="${coverFile}" "${filePath}"`, execOptions);
          log(`[METAFLAC] ✓ Cover written`);
          fs.unlinkSync(coverFile);
        }
      } catch (e: any) {
        log(`[METAFLAC] Warning: Failed to add cover: ${e.message}`);
      }
    } else if (existingCoverPath && fs.existsSync(existingCoverPath)) {
      try {
        log(`[METAFLAC] Restoring existing cover from: ${existingCoverPath}`);
        execSync(`"${metaflacBinary}" --import-picture-from="${existingCoverPath}" "${filePath}"`, execOptions);
        log(`[METAFLAC] ✓ Existing cover restored`);
      } catch (e: any) {
        log(`[METAFLAC] Warning: Failed to restore existing cover: ${e.message}`);
      }
    }

    log(`[METAFLAC] Success, removing backup`);
    fs.unlinkSync(backupPath);

    if (existingCoverPath && fs.existsSync(existingCoverPath)) {
      try {
        fs.unlinkSync(existingCoverPath);
        log(`[METAFLAC] ✓ Cleaned up existing cover temp file`);
      } catch (e: any) {
        log(`[METAFLAC] Warning: Failed to clean up existing cover temp file: ${e.message}`);
      }
    }

    log('[METAFLAC] ✓ Metadata written successfully');
    return true;
  } catch (e) {
    log(`[METAFLAC] ✗ Error: ${(e as Error).message}`);
    const backupPath = filePath + '.backup';
    if (fs.existsSync(backupPath)) {
      log(`[METAFLAC] Restoring from backup`);
      try {
        fs.copyFileSync(backupPath, filePath);
        fs.unlinkSync(backupPath);
        log(`[METAFLAC] ✓ Backup restored`);
      } catch (restoreError) {
        log(`[METAFLAC] ✗ Failed to restore backup`);
      }
    }
    throw e;
  }
}

export async function writeAudioMetadata(
  filePath: string,
  metadata: {
    title?: string;
    artist?: string;
    album?: string;
    lyrics?: string;
    coverUrl?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const expandedPath = expandHomeDir(filePath);
  logger.info('[Main] Writing metadata to:', expandedPath);
  logger.info('[Main] Metadata:', metadata);

  if (!fs.existsSync(expandedPath)) {
    logger.error('[Main] File does not exist:', expandedPath);
    return { success: false, error: '文件不存在' };
  }

  const stats = fs.statSync(expandedPath);
  logger.info('[Main] File size:', stats.size, 'bytes');

  const ext = path.extname(expandedPath).toLowerCase();
  const actualFormat = detectFileFormat(expandedPath);
  logger.info('[Main] File extension:', ext, '| Detected format:', actualFormat);

  if (actualFormat === 'error') {
    return { success: false, error: '无法检测文件格式' };
  }

  let coverBuffer: Buffer | undefined;
  if (metadata.coverUrl) {
    try {
      if (metadata.coverUrl.startsWith('data:')) {
        logger.info('[Main] Parsing data URL cover');
        const matches = metadata.coverUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (matches && matches[2]) {
          coverBuffer = Buffer.from(matches[2], 'base64');
          logger.info('[Main] Cover parsed from data URL, size:', coverBuffer.length);
        }
      } else if (metadata.coverUrl.startsWith('cover://')) {
        const coverFileName = metadata.coverUrl.slice('cover://'.length);
        const coverPathLoc = path.join(app.getPath('userData'), 'covers', coverFileName);
        logger.info('[Main] Reading cover from local path:', coverPathLoc);
        if (fs.existsSync(coverPathLoc)) {
          coverBuffer = fs.readFileSync(coverPathLoc);
          logger.info('[Main] Cover read from local file, size:', coverBuffer.length);
        }
      } else {
        logger.info('[Main] Downloading cover from:', metadata.coverUrl.substring(0, 100));
        const response = await fetch(metadata.coverUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Referer': 'https://y.qq.com/',
          },
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          coverBuffer = Buffer.from(arrayBuffer);
          logger.info('[Main] Cover downloaded, size:', coverBuffer.length);
        }
      }
    } catch (e) {
      logger.error('[Main] Failed to process cover:', e);
    }
  }

  let success = false;

  if (actualFormat === 'mp3') {
    const tags: any = {};
    if (metadata.title) tags.title = metadata.title;
    if (metadata.artist) tags.artist = metadata.artist;
    if (metadata.album) tags.album = metadata.album;
    if (metadata.lyrics) tags.unsynchronisedLyrics = { language: 'chi', text: metadata.lyrics };
    if (coverBuffer) {
      tags.image = {
        mime: 'image/jpeg',
        type: { id: 3, name: 'Cover (front)' },
        description: 'Cover',
        imageBuffer: coverBuffer
      };
    }

    const result = NodeID3.write(tags, expandedPath);
    success = !!result;
    logger.info('[Main] MP3 metadata write result:', success);
  } else if (actualFormat === 'flac') {
    logger.info('[Main] FLAC metadata write using ffmpeg remux');
    try {
      logger.info('[Main] Attempting ffmpeg remux with metadata:', {
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        lyricsLength: metadata.lyrics?.length || 0,
        hasCover: !!coverBuffer
      });
      success = await writeFlacMetadataWithFfmpeg(expandedPath, {
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        lyrics: metadata.lyrics,
      }, coverBuffer);
      logger.info('[Main] FFmpeg remux completed, success:', success);
    } catch (ffmpegError) {
      logger.warn('[Main] FFmpeg FLAC metadata write failed, fallback to direct block write');
      success = await writeFlacMetadata(expandedPath, metadata, coverBuffer);
    }
    logger.info('[Main] FLAC metadata write final result:', success);
  } else {
    logger.warn('[Main] Unsupported file format for metadata:', actualFormat);
    return { success: false, error: `不支持的文件格式: ${actualFormat} (扩展名: ${ext})` };
  }

  return { success };
}