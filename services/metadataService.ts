import { logger } from './logger';

export interface ParsedMetadata {
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  lyrics: string;
  syncedLyrics?: { time: number; text: string }[];
  audioUrl: string;
  file: File;
}

interface WorkerMetadataResult {
  title?: string;
  artist?: string;
  album?: string;
  lyrics?: string;
  syncedLyrics?: { time: number; text: string }[];
  coverData?: ArrayBuffer;
  coverMime?: string;
}

let metadataWorker: Worker | null = null;
let metadataWorkerSeq = 0;
const metadataWorkerPending = new Map<number, { resolve: (value: WorkerMetadataResult | null) => void; reject: (reason: unknown) => void }>();
const metadataWorkerCache = new Map<string, WorkerMetadataResult>();
const metadataWorkerInFlight = new Map<string, Promise<WorkerMetadataResult | null>>();
const METADATA_CACHE_LIMIT = 50;

function getWorkerCacheKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function setWorkerCache(key: string, value: WorkerMetadataResult) {
  if (metadataWorkerCache.has(key)) {
    metadataWorkerCache.delete(key);
  }
  metadataWorkerCache.set(key, value);
  while (metadataWorkerCache.size > METADATA_CACHE_LIMIT) {
    const oldestKey = metadataWorkerCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    metadataWorkerCache.delete(oldestKey);
  }
}

function getMetadataWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!metadataWorker) {
    metadataWorker = new Worker(new URL('./workers/metadataWorker.ts', import.meta.url), { type: 'module' });
    metadataWorker.onmessage = (event: MessageEvent<{ id: number; result?: WorkerMetadataResult; error?: string }>) => {
      const { id, result, error } = event.data;
      const pending = metadataWorkerPending.get(id);
      if (!pending) return;
      metadataWorkerPending.delete(id);
      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result || null);
      }
    };
    metadataWorker.onerror = (event) => {
      for (const [, pending] of metadataWorkerPending) {
        pending.reject(event);
      }
      metadataWorkerPending.clear();
      metadataWorker = null;
    };
  }
  return metadataWorker;
}

async function parseMetadataInWorker(file: File): Promise<WorkerMetadataResult | null> {
  const worker = getMetadataWorker();
  if (!worker) return null;

  const cacheKey = getWorkerCacheKey(file);
  const cached = metadataWorkerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = metadataWorkerInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    const buffer = await file.arrayBuffer();
    return new Promise<WorkerMetadataResult | null>((resolve, reject) => {
      const id = ++metadataWorkerSeq;
      metadataWorkerPending.set(id, { resolve, reject });
      worker.postMessage({ id, fileName: file.name, buffer }, [buffer]);
    });
  })();

  metadataWorkerInFlight.set(cacheKey, promise);

  return promise.then((result) => {
    if (result) {
      setWorkerCache(cacheKey, result);
    }
    return result;
  }).finally(() => {
    metadataWorkerInFlight.delete(cacheKey);
  });
}

// Helper function to read string from DataView
function getStringFromView(view: DataView, offset: number, length: number): string {
  let str = '';
  for (let i = 0; i < length; i++) {
    const char = view.getUint8(offset + i);
    if (char > 0) {
      str += String.fromCharCode(char);
    }
  }
  return str;
}

// Decode synchsafe integer (7 bits per byte, used in ID3v2)
function decodeSynchsafe(value: number): number {
  const out = [];
  out.push(value & 0x7F);
  out.push((value >> 8) & 0x7F);
  out.push((value >> 16) & 0x7F);
  out.push((value >> 24) & 0x7F);
  return (out[0] << 21) | (out[1] << 14) | (out[2] << 7) | out[3];
}

// Decode text frame with proper encoding handling
function decodeTextFrame(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  const encoding = view.getUint8(0);
  const data = buffer.slice(1);

  let text = '';
  try {
    if (encoding === 0 || encoding === 3) {
      // ISO-8859-1 or UTF-8
      text = new TextDecoder(encoding === 3 ? 'utf-8' : 'iso-8859-1').decode(data);
    } else if (encoding === 1 || encoding === 2) {
      // UTF-16 with BOM
      text = new TextDecoder('utf-16').decode(data);
    }
  } catch (e) {
    logger.error('Error decoding text frame:', e);
  }

  // Remove null characters, BOM, and trim
  return text
    .replace(/\0/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\uFFFF/g, '')
    .trim();
}

// Parse USLT (Unsynchronized Lyrics) frame
// Structure: <text encoding> $xx <language> $xx xx xx <content descriptor> <text>
function parseUSLTFrame(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  let offset = 0;

  try {
    // 1 byte: text encoding
    const encoding = view.getUint8(offset);
    offset += 1;

    // 3 bytes: language (e.g., "eng")
    offset += 3;

    // Skip content descriptor (null terminated string)
    while (offset < buffer.byteLength) {
      if (encoding === 0 || encoding === 3) {
        // ISO-8859-1 or UTF-8 (1 byte per char)
        if (view.getUint8(offset) === 0) {
          offset += 1;
          break;
        }
        offset += 1;
      } else {
        // UTF-16 (2 bytes per char)
        if (view.getUint16(offset, false) === 0) {
          offset += 2;
          break;
        }
        offset += 2;
      }
    }

    // The rest is the lyrics text
    const textData = buffer.slice(offset);
    
    let text = '';
    if (encoding === 0 || encoding === 3) {
      text = new TextDecoder(encoding === 3 ? 'utf-8' : 'iso-8859-1').decode(textData);
    } else if (encoding === 1 || encoding === 2) {
      text = new TextDecoder('utf-16').decode(textData);
    }

    return text
      .replace(/\0/g, '')
      .replace(/\uFEFF/g, '')
      .replace(/\uFFFF/g, '')
      .trim();
  } catch (e) {
    logger.error('Error parsing USLT frame:', e);
    return '';
  }
}

// Decode picture (APIC) frame
function decodePictureFrame(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  let offset = 0;

  try {
    // Read encoding byte
    const encoding = view.getUint8(offset);
    offset += 1;

    // Read MIME type (null terminated string)
    let mimeTypeEnd = offset;
    while (mimeTypeEnd < buffer.byteLength && view.getUint8(mimeTypeEnd) !== 0) {
      mimeTypeEnd++;
    }
    const mimeType = getStringFromView(view, offset, mimeTypeEnd - offset);
    offset = mimeTypeEnd + 1; // Skip null terminator

    // Skip picture type (1 byte)
    offset += 1;

    // Skip description (null terminated string with encoding)
    while (offset < buffer.byteLength) {
      if (encoding === 0 || encoding === 3) {
        // ISO-8859-1 or UTF-8
        if (view.getUint8(offset) === 0) {
          offset += 1;
          break;
        }
        offset += 1;
      } else {
        // UTF-16
        if (view.getUint16(offset, false) === 0) {
          offset += 2;
          break;
        }
        offset += 2;
      }
    }

    // The rest is image data
    const imageData = buffer.slice(offset);

    // Create blob URL
    const blob = new Blob([imageData], { type: mimeType || 'image/jpeg' });
    return URL.createObjectURL(blob);
  } catch (e) {
    logger.error('Error in decodePictureFrame:', e);
    return '';
  }
}

// Simple ID3v2 parser for MP3 files
function parseID3v2(buffer: ArrayBuffer): Partial<ParsedMetadata> {
  const view = new DataView(buffer);
  const result: Partial<ParsedMetadata> = {};

  // Check for ID3v2 header
  const header = getStringFromView(view, 0, 3);
  if (header !== 'ID3') {
    return result;
  }

  const majorVersion = view.getUint8(3);
  const flags = view.getUint8(5);
  const size = decodeSynchsafe(view.getUint32(6));

  // Check for extended header (ID3v2.3 and ID3v2.4)
  let offset = 10;
  if (flags & 0x40) {
    // Extended header present, skip it
    const extSize = majorVersion === 4 
      ? decodeSynchsafe(view.getUint32(offset))
      : view.getUint32(offset);
    offset += extSize + 4;
  }

  const end = Math.min(size + 10, buffer.byteLength);
  
  // ID3v2.3 uses non-synchsafe frame sizes, ID3v2.4 uses synchsafe
  const isV23 = majorVersion === 3;
  const isV24 = majorVersion === 4;

  while (offset < end) {
    // Read frame header
    const frameId = getStringFromView(view, offset, 4);

    // Check if we hit padding
    if (frameId === '') {
      break;
    }

    // Frame size encoding differs between ID3v2.3 and ID3v2.4
    const rawFrameSize = view.getUint32(offset + 4);
    const frameSize = isV23 ? rawFrameSize : decodeSynchsafe(rawFrameSize);

    if (frameSize === 0 || frameSize > buffer.byteLength || offset + 10 + frameSize > end) {
      break;
    }

    // Parse frames based on ID
    const frameData = buffer.slice(offset + 10, offset + 10 + frameSize);

    if (frameId.startsWith('T')) {
      // Text frames
      const text = decodeTextFrame(frameData);
      if (text) {
        switch (frameId) {
          case 'TIT2':
            result.title = text;
            break;
          case 'TPE1':
            result.artist = text;
            break;
          case 'TALB':
            result.album = text;
            break;
        }
      }
    } else if (frameId === 'USLT') {
      // Unsynchronized lyrics - parse with LRC parser to extract timestamps if present
      const text = parseUSLTFrame(frameData);
      if (text) {
        const parsedLyrics = parseLRCLyrics(text);
        result.lyrics = parsedLyrics.plainText;
        result.syncedLyrics = parsedLyrics.syncedLyrics;
      }
    } else if (frameId === 'SYLT') {
      // Synchronized lyrics (SYLT frame)
      const syncedLyrics = parseSYLTFrame(frameData);
      if (syncedLyrics.length > 0) {
        result.syncedLyrics = syncedLyrics;
        result.lyrics = syncedLyrics.map(l => l.text).join('\n');
      }
    } else if (frameId === 'APIC') {
      // Attached picture
      result.coverUrl = decodePictureFrame(frameData);
    }

    offset += 10 + frameSize;
  }

  return result;
}

// Parse SYLT (Synchronized Lyrics/Text) frame
function parseSYLTFrame(buffer: ArrayBuffer): { time: number; text: string }[] {
  const view = new DataView(buffer);
  const syncedLyrics: { time: number; text: string }[] = [];

  try {
    let offset = 0;
    const encoding = view.getUint8(offset);
    offset += 1;

    // Language (3 bytes)
    offset += 3;

    // Time stamp format (1 byte)
    const timeStampFormat = view.getUint8(offset);
    offset += 1;

    // Content type (1 byte)
    offset += 1;

    // Content descriptor (null terminated string)
    while (offset < buffer.byteLength) {
      if (encoding === 0 || encoding === 3) {
        if (view.getUint8(offset) === 0) {
          offset += 1;
          break;
        }
      } else {
        if (view.getUint16(offset, false) === 0) {
          offset += 2;
          break;
        }
      }
      offset += (encoding === 0 || encoding === 3) ? 1 : 2;
    }

    // Parse synchronized text entries
    while (offset < buffer.byteLength - 4) {
      // Read text until null terminator
      let text = '';
      while (offset < buffer.byteLength) {
        if (encoding === 0 || encoding === 3) {
          const byte = view.getUint8(offset);
          if (byte === 0) {
            offset += 1;
            break;
          }
          text += String.fromCharCode(byte);
          offset += 1;
        } else {
          const char = view.getUint16(offset, false);
          if (char === 0) {
            offset += 2;
            break;
          }
          text += String.fromCharCode(char);
          offset += 2;
        }
      }

      // Read time stamp (4 bytes)
      if (offset + 4 <= buffer.byteLength) {
        const timeStamp = view.getUint32(offset, false);
        offset += 4;

        // Convert time stamp to seconds based on format
        let timeInSeconds: number;
        if (timeStampFormat === 1) {
          // MPEG frames
          timeInSeconds = timeStamp / 1000; // Approximate
        } else if (timeStampFormat === 2) {
          // Milliseconds
          timeInSeconds = timeStamp / 1000;
        } else {
          // Default to milliseconds
          timeInSeconds = timeStamp / 1000;
        }

        if (text.trim()) {
          syncedLyrics.push({
            time: timeInSeconds,
            text: text.trim()
          });
        }
      }
    }

    return syncedLyrics;
  } catch (e) {
    logger.error('Error parsing SYLT frame:', e);
    return [];
  }
}

// MP4/M4A metadata parser (simplified)
function parseMP4(buffer: ArrayBuffer): Partial<ParsedMetadata> {
  const result: Partial<ParsedMetadata> = {};
  // MP4 parsing is complex, would need full atom parsing
  // For now, return empty to fall back to defaults
  return result;
}

// FLAC metadata parser with full VORBIS_COMMENT and PICTURE support
function parseFLAC(buffer: ArrayBuffer): Partial<ParsedMetadata> {
  const result: Partial<ParsedMetadata> = {};

  const view = new DataView(buffer);

  // Check for FLAC signature
  const signature = getStringFromView(view, 0, 4);
  if (signature !== 'fLaC') {
    return result;
  }

  let offset = 4; // Skip signature

  // Parse metadata blocks
  while (offset < buffer.byteLength - 4) {
    const header = view.getUint8(offset);
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7F;

    // Block size is 3 bytes (big endian)
    const blockSize = (view.getUint8(offset + 1) << 16) |
                     (view.getUint8(offset + 2) << 8) |
                     (view.getUint8(offset + 3));

    offset += 4; // Skip block header

    const blockData = buffer.slice(offset, offset + blockSize);

    if (blockType === 4) {
      // VORBIS_COMMENT block
      const comments = parseVorbisComment(blockData);
      Object.assign(result, comments);
    } else if (blockType === 6) {
      // PICTURE block
      result.coverUrl = parseFLACPicture(blockData);
    }

    offset += blockSize;

    if (isLast || blockType === 6) {
      // PICTURE is usually the last metadata block we care about
      // Or if this is the last block, stop parsing
      if (isLast) break;
    }
  }

  return result;
}

// Parse VORBIS_COMMENT block
function parseVorbisComment(buffer: ArrayBuffer): Partial<ParsedMetadata> {
  const result: Partial<ParsedMetadata> = {};
  const view = new DataView(buffer);
  let offset = 0;

  try {
    // Vendor string length (4 bytes, little endian)
    const vendorLength = view.getUint32(offset, true);
    offset += 4;

    // Skip vendor string
    offset += vendorLength;

    // Comment list length (4 bytes, little endian)
    const commentCount = view.getUint32(offset, true);
    offset += 4;

    // Parse each comment
    for (let i = 0; i < commentCount && offset < buffer.byteLength; i++) {
      // Comment length (4 bytes, little endian)
      const commentLength = view.getUint32(offset, true);
      offset += 4;

      // Comment string (UTF-8)
      const commentBytes = buffer.slice(offset, offset + commentLength);
      const comment = new TextDecoder('utf-8').decode(commentBytes);
      offset += commentLength;

      // Parse FIELD=value format
      const equalPos = comment.indexOf('=');
      if (equalPos > 0) {
        const field = comment.substring(0, equalPos).toUpperCase();
        const value = comment.substring(equalPos + 1);
        const hasLrcTimestamp = /\[\d{2}:\d{2}(?:\.\d{1,3})?\]/.test(value);

        // Map common Vorbis comment fields to our metadata
        switch (field) {
          case 'TITLE':
            result.title = value;
            break;
          case 'ARTIST':
            result.artist = value;
            break;
          case 'ALBUM':
            result.album = value;
            break;
          case 'LYRICS':
          case 'UNSYNCEDLYRICS':
          case 'LYRIC':
          case 'SYNCEDLYRICS':
          case 'SYNCHRONIZEDLYRICS': {
            const parsedLyrics = parseLRCLyrics(value);
            result.lyrics = parsedLyrics.plainText;
            result.syncedLyrics = parsedLyrics.syncedLyrics;
            break;
          }
          case 'COMMENT':
          case 'DESCRIPTION':
            // ffmpeg may place lyrics in COMMENT/DESCRIPTION on some platforms.
            // Only treat them as lyrics when they clearly look like LRC.
            if (!result.lyrics && hasLrcTimestamp) {
              const parsedLyrics = parseLRCLyrics(value);
              result.lyrics = parsedLyrics.plainText;
              result.syncedLyrics = parsedLyrics.syncedLyrics;
            }
            break;
          case 'TRACKNUMBER':
          case 'TRACK':
            // Could be used for track number, but we don't store it
            break;
        }
      }
    }
  } catch (e) {
    logger.error('Error parsing VORBIS_COMMENT:', e);
  }

  return result;
}

// Parse LRC format lyrics (with timestamps like [00:12.34] or [00:00:00])
function parseLRCLyrics(lrc: string): { plainText: string; syncedLyrics: { time: number; text: string }[] } {
  const lines = lrc.split(/\r?\n/);
  const syncedLyrics: { time: number; text: string }[] = [];
  const plainTextLines: string[] = [];

  // LRC timestamp format: [mm:ss.xx], [mm:ss], or [hh:mm:ss]
  const timeRegex = /\[(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Extract all timestamps and text from the line
    const matches = [...trimmedLine.matchAll(timeRegex)];
    const textWithoutTimestamps = trimmedLine.replace(timeRegex, '').trim();

    // Skip placeholder lines like "//"
    if (textWithoutTimestamps === '//') continue;

    if (matches.length > 0 && textWithoutTimestamps) {
      // Parse each timestamp and add to synced lyrics
      for (const match of matches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        // match[3] is seconds in [hh:mm:ss] format, match[4] is milliseconds
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
          // [mm:ss.xx] or [mm:ss] format
          timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
        }

        syncedLyrics.push({
          time: timeInSeconds,
          text: textWithoutTimestamps
        });
      }
      plainTextLines.push(textWithoutTimestamps);
    } else if (textWithoutTimestamps) {
      // Line without timestamp, just add to plain text
      plainTextLines.push(textWithoutTimestamps);
    }
  }

  // Sort synced lyrics by time
  syncedLyrics.sort((a, b) => a.time - b.time);

  return {
    plainText: plainTextLines.join('\n'),
    syncedLyrics: syncedLyrics.length > 0 ? syncedLyrics : undefined
  };
}

// Parse FLAC PICTURE block
function parseFLACPicture(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  let offset = 0;

  try {
    // Picture type (4 bytes, BIG endian)
    offset += 4;

    // MIME type length (4 bytes, BIG endian)
    const mimeTypeLength = view.getUint32(offset, false);
    offset += 4;

    // MIME type (UTF-8 string)
    const mimeTypeBytes = buffer.slice(offset, offset + mimeTypeLength);
    const mimeType = new TextDecoder('utf-8').decode(mimeTypeBytes);
    offset += mimeTypeLength;

    // Picture description length (4 bytes, BIG endian)
    const descriptionLength = view.getUint32(offset, false);
    offset += 4;

    // Skip description (UTF-8 string)
    offset += descriptionLength;

    // Width, height, color depth, color count (4 bytes each, BIG endian)
    offset += 16;

    // Picture data length (4 bytes, BIG endian)
    const pictureDataLength = view.getUint32(offset, false);
    offset += 4;

    // Picture data
    const pictureData = buffer.slice(offset, offset + pictureDataLength);

    // Create blob URL
    const blob = new Blob([pictureData], { type: mimeType || 'image/jpeg' });
    return URL.createObjectURL(blob);
  } catch (e) {
    logger.error('Error parsing FLAC picture:', e);
    return '';
  }
}

// Export libraryStorage for persistence
export { libraryStorage } from './libraryStorage';

/**
 * Helper function to get audio duration without blocking
 * Uses a hidden audio element and waits for loadedmetadata event
 */
function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const objectUrl = URL.createObjectURL(file);

    // Set a short timeout (2 seconds) to avoid hanging
    const timeout = setTimeout(() => {
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(objectUrl);
      logger.warn('[MetadataService] Duration fetch timeout for:', file.name);
      resolve(0); // Return 0 if timeout
    }, 2000);

    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout);
      const duration = audio.duration;
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(objectUrl);
      resolve(duration || 0);
    }, { once: true });

    audio.addEventListener('error', () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      logger.warn('[MetadataService] Failed to load audio for duration:', file.name);
      resolve(0); // Return 0 on error
    }, { once: true });

    // Start loading
    audio.src = objectUrl;
  });
}

export async function parseAudioFile(file: File): Promise<ParsedMetadata> {
  const audioUrl = URL.createObjectURL(file);
  // Default values
  const defaultResult: ParsedMetadata = {
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: 'Unknown Artist',
    album: 'Unknown Album',
    duration: 0,
    coverUrl: `https://picsum.photos/seed/${encodeURIComponent(file.name)}/1000/1000`,
    lyrics: '',
    audioUrl,
    file
  };

  try {
    let metadata: Partial<ParsedMetadata> = {};
    let coverUrl = defaultResult.coverUrl;
    let workerParsed = false;

    // Try parsing in Web Worker first
    try {
      const workerResult = await parseMetadataInWorker(file);
      if (workerResult) {
        workerParsed = true;
        metadata = {
          title: workerResult.title,
          artist: workerResult.artist,
          album: workerResult.album,
          lyrics: workerResult.lyrics || '',
          syncedLyrics: workerResult.syncedLyrics
        };

        if (workerResult.coverData) {
          const blob = new Blob([workerResult.coverData], { type: workerResult.coverMime || 'image/jpeg' });
          coverUrl = URL.createObjectURL(blob);
        }
      }
    } catch (error) {
      logger.warn('[MetadataService] Worker parse failed, falling back to main thread:', error);
    }

    // Fallback to main thread parsing if worker was unavailable
    if (!workerParsed) {
      const arrayBuffer = await file.arrayBuffer();
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.mp3')) {
        metadata = parseID3v2(arrayBuffer);
      } else if (lowerName.endsWith('.m4a') || lowerName.endsWith('.mp4')) {
        metadata = parseMP4(arrayBuffer);
      } else if (lowerName.endsWith('.flac')) {
        metadata = parseFLAC(arrayBuffer);
      }

      if (metadata.coverUrl) {
        coverUrl = metadata.coverUrl;
      }
    }

    // Get duration in parallel (non-blocking, short timeout)
    // This is much faster than the old 5-second timeout approach
    const duration = await getAudioDuration(file);

    return {
      title: metadata.title || defaultResult.title,
      artist: metadata.artist || defaultResult.artist,
      album: metadata.album || defaultResult.album,
      duration: duration || 0,
      coverUrl,
      lyrics: metadata.lyrics || '',
      syncedLyrics: metadata.syncedLyrics,
      audioUrl,
      file
    };
  } catch (error) {
    logger.error("Metadata parsing error:", file.name, error);
    return defaultResult;
  }
}
