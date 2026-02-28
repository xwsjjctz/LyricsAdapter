/// <reference lib="webworker" />

type SyncedLyricLine = { time: number; text: string };

interface WorkerMetadataResult {
  title?: string;
  artist?: string;
  album?: string;
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
  coverData?: ArrayBuffer;
  coverMime?: string;
}

interface WorkerRequest {
  id: number;
  fileName: string;
  buffer: ArrayBuffer;
}

interface WorkerResponse {
  id: number;
  result?: WorkerMetadataResult;
  error?: string;
}

// Worker context type - using any to avoid TypeScript conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx: any = self;

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

function decodeSynchsafe(value: number): number {
  const out = [];
  out.push(value & 0x7F);
  out.push((value >> 8) & 0x7F);
  out.push((value >> 16) & 0x7F);
  out.push((value >> 24) & 0x7F);
  return (out[0] << 21) | (out[1] << 14) | (out[2] << 7) | out[3];
}

function decodeTextFrame(buffer: ArrayBuffer): string {
  const view = new DataView(buffer);
  const encoding = view.getUint8(0);
  const data = buffer.slice(1);

  let text = '';
  try {
    if (encoding === 0 || encoding === 3) {
      text = new TextDecoder(encoding === 3 ? 'utf-8' : 'iso-8859-1').decode(data);
    } else if (encoding === 1 || encoding === 2) {
      text = new TextDecoder('utf-16').decode(data);
    }
  } catch {
    // Ignore decode errors
  }

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
  } catch {
    return '';
  }
}

function decodePictureFrame(buffer: ArrayBuffer): { mime?: string; data?: ArrayBuffer } {
  const view = new DataView(buffer);
  let offset = 0;

  try {
    const encoding = view.getUint8(offset);
    offset += 1;

    let mimeTypeEnd = offset;
    while (mimeTypeEnd < buffer.byteLength && view.getUint8(mimeTypeEnd) !== 0) {
      mimeTypeEnd++;
    }
    const mimeType = getStringFromView(view, offset, mimeTypeEnd - offset);
    offset = mimeTypeEnd + 1;

    offset += 1; // picture type

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

    const imageData = buffer.slice(offset);
    return { mime: mimeType || 'image/jpeg', data: imageData };
  } catch {
    return {};
  }
}

function parseLRCLyrics(lrc: string): { plainText: string; syncedLyrics: SyncedLyricLine[] } {
  const lines = lrc.split(/\r?\n/);
  const syncedLyrics: SyncedLyricLine[] = [];
  const plainTextLines: string[] = [];

  // LRC timestamp format: [mm:ss.xx], [mm:ss], or [hh:mm:ss]
  const timeRegex = /\[(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const matches = [...trimmedLine.matchAll(timeRegex)];
    const textWithoutTimestamps = trimmedLine.replace(timeRegex, '').trim();

    // Skip placeholder lines like "//"
    if (textWithoutTimestamps === '//') continue;

    if (matches.length > 0 && textWithoutTimestamps) {
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
      plainTextLines.push(textWithoutTimestamps);
    }
  }

  syncedLyrics.sort((a, b) => a.time - b.time);

  return {
    plainText: plainTextLines.join('\n'),
    syncedLyrics
  };
}

function parseVorbisComment(buffer: ArrayBuffer): Partial<WorkerMetadataResult> {
  const result: Partial<WorkerMetadataResult> = {};
  const view = new DataView(buffer);
  let offset = 0;

  try {
    const vendorLength = view.getUint32(offset, true);
    offset += 4 + vendorLength;

    const commentCount = view.getUint32(offset, true);
    offset += 4;

    for (let i = 0; i < commentCount && offset < buffer.byteLength; i++) {
      const commentLength = view.getUint32(offset, true);
      offset += 4;

      const commentBytes = buffer.slice(offset, offset + commentLength);
      const comment = new TextDecoder('utf-8').decode(commentBytes);
      offset += commentLength;

      const equalPos = comment.indexOf('=');
      if (equalPos > 0) {
        const field = comment.substring(0, equalPos).toUpperCase();
        const value = comment.substring(equalPos + 1);
        const hasLrcTimestamp = /\[\d{2}:\d{2}(?:\.\d{1,3})?\]/.test(value);

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
            result.syncedLyrics = parsedLyrics.syncedLyrics.length > 0 ? parsedLyrics.syncedLyrics : undefined;
            break;
          }
          case 'COMMENT':
          case 'DESCRIPTION':
            // ffmpeg may place lyrics in COMMENT/DESCRIPTION on some platforms.
            // Only treat them as lyrics when they clearly look like LRC.
            if (!result.lyrics && hasLrcTimestamp) {
              const parsedLyrics = parseLRCLyrics(value);
              result.lyrics = parsedLyrics.plainText;
              result.syncedLyrics = parsedLyrics.syncedLyrics.length > 0 ? parsedLyrics.syncedLyrics : undefined;
            }
            break;
          default:
            break;
        }
      }
    }
  } catch (e) {
    // Silently handle parse errors
  }

  return result;
}

function parseFLACPicture(buffer: ArrayBuffer): { mime?: string; data?: ArrayBuffer } {
  const view = new DataView(buffer);
  let offset = 0;

  try {
    offset += 4; // picture type

    const mimeTypeLength = view.getUint32(offset, false);
    offset += 4;

    const mimeTypeBytes = buffer.slice(offset, offset + mimeTypeLength);
    const mimeType = new TextDecoder('utf-8').decode(mimeTypeBytes);
    offset += mimeTypeLength;

    const descriptionLength = view.getUint32(offset, false);
    offset += 4;

    offset += descriptionLength;

    offset += 16; // width/height/depth/colors

    const pictureDataLength = view.getUint32(offset, false);
    offset += 4;

    const pictureData = buffer.slice(offset, offset + pictureDataLength);
    return { mime: mimeType || 'image/jpeg', data: pictureData };
  } catch {
    return {};
  }
}

function parseID3v2(buffer: ArrayBuffer): Partial<WorkerMetadataResult> {
  const view = new DataView(buffer);
  const result: Partial<WorkerMetadataResult> = {};

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
    const frameId = getStringFromView(view, offset, 4);
    if (frameId === '') {
      break;
    }

    // Frame size encoding differs between ID3v2.3 and ID3v2.4
    const rawFrameSize = view.getUint32(offset + 4);
    const frameSize = isV23 ? rawFrameSize : decodeSynchsafe(rawFrameSize);
    
    if (frameSize === 0 || frameSize > buffer.byteLength || offset + 10 + frameSize > end) {
      break;
    }

    const frameData = buffer.slice(offset + 10, offset + 10 + frameSize);

    if (frameId.startsWith('T')) {
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
          default:
            break;
        }
      }
    } else if (frameId === 'USLT') {
      // Unsynchronized lyrics - parse with LRC parser to extract timestamps if present
      const text = parseUSLTFrame(frameData);
      if (text) {
        const parsedLyrics = parseLRCLyrics(text);
        result.lyrics = parsedLyrics.plainText;
        result.syncedLyrics = parsedLyrics.syncedLyrics.length > 0 ? parsedLyrics.syncedLyrics : undefined;
      }
    } else if (frameId === 'SYLT') {
      // Synchronized lyrics (SYLT frame)
      const syncedLyrics = parseSYLTFrame(frameData);
      if (syncedLyrics.length > 0) {
        result.syncedLyrics = syncedLyrics;
        result.lyrics = syncedLyrics.map(l => l.text).join('\n');
      }
    } else if (frameId === 'APIC') {
      const picture = decodePictureFrame(frameData);
      if (picture.data) {
        result.coverData = picture.data;
        result.coverMime = picture.mime;
      }
    }

    offset += 10 + frameSize;
  }

  return result;
}

// Parse SYLT (Synchronized Lyrics/Text) frame
function parseSYLTFrame(buffer: ArrayBuffer): SyncedLyricLine[] {
  const view = new DataView(buffer);
  const syncedLyrics: SyncedLyricLine[] = [];

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
  } catch {
    return [];
  }
}

function parseMP4(_buffer: ArrayBuffer): Partial<WorkerMetadataResult> {
  return {};
}

function parseFLAC(buffer: ArrayBuffer): Partial<WorkerMetadataResult> {
  const result: Partial<WorkerMetadataResult> = {};
  const view = new DataView(buffer);

  const signature = getStringFromView(view, 0, 4);
  if (signature !== 'fLaC') {
    return result;
  }

  let offset = 4;

  while (offset < buffer.byteLength - 4) {
    const header = view.getUint8(offset);
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7F;

    const blockSize = (view.getUint8(offset + 1) << 16) |
                     (view.getUint8(offset + 2) << 8) |
                     (view.getUint8(offset + 3));

    offset += 4;

    const blockData = buffer.slice(offset, offset + blockSize);

    if (blockType === 4) {
      Object.assign(result, parseVorbisComment(blockData));
    } else if (blockType === 6) {
      const picture = parseFLACPicture(blockData);
      if (picture.data) {
        result.coverData = picture.data;
        result.coverMime = picture.mime;
      }
    }

    offset += blockSize;

    if (isLast) break;
  }

  return result;
}

function parseMetadata(buffer: ArrayBuffer, fileName: string): WorkerMetadataResult {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.mp3')) {
    return parseID3v2(buffer);
  }
  if (lowerName.endsWith('.m4a') || lowerName.endsWith('.mp4')) {
    return parseMP4(buffer);
  }
  if (lowerName.endsWith('.flac')) {
    return parseFLAC(buffer);
  }
  return {};
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, fileName, buffer } = event.data;
  try {
    const result = parseMetadata(buffer, fileName);
    const transfer: Transferable[] = [];
    if (result.coverData) {
      transfer.push(result.coverData);
    }
    const response: WorkerResponse = { id, result };
    ctx.postMessage(response, transfer);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      error: error instanceof Error ? error.message : String(error)
    };
    ctx.postMessage(response);
  }
};

export {};
