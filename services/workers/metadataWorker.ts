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

const ctx: DedicatedWorkerGlobalScope = self as any;

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

    while (offset < buffer.byteLength) {
      if (view.getUint8(offset) === 0 && view.getUint8(offset + 1) === 0) {
        offset += 2;
        break;
      }
      if (view.getUint8(offset) === 0 && encoding === 0) {
        offset += 1;
        break;
      }
      offset++;
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

  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

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
        const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;

        const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;
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

        // Debug logging for ALBUM field
        if (field === 'ALBUM') {
          console.log('[Worker] Found ALBUM:', value);
        }

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
            const parsedLyrics = parseLRCLyrics(value);
            result.lyrics = parsedLyrics.plainText;
            result.syncedLyrics = parsedLyrics.syncedLyrics.length > 0 ? parsedLyrics.syncedLyrics : undefined;
            break;
          default:
            break;
        }
      }
    }

    // Log final result
    console.log('[Worker] Parsed metadata:', { title: result.title, artist: result.artist, album: result.album });
  } catch (e) {
    console.error('[Worker] Vorbis comment parse error:', e);
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

  const size = decodeSynchsafe(view.getUint32(6));

  let offset = 10;
  const end = Math.min(size + 10, buffer.byteLength);

  while (offset < end) {
    const frameId = getStringFromView(view, offset, 4);
    if (frameId === '') {
      break;
    }

    const frameSize = decodeSynchsafe(view.getUint32(offset + 4));
    if (frameSize === 0 || offset + 10 + frameSize > end) {
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
      const text = decodeTextFrame(frameData.slice(1));
      if (text) {
        result.lyrics = text;
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
