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
    console.error('Error decoding text frame:', e);
  }

  // Remove null characters, BOM, and trim
  return text
    .replace(/\0/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\uFFFF/g, '')
    .trim();
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

    // The rest is image data
    const imageData = buffer.slice(offset);

    // Create blob URL
    const blob = new Blob([imageData], { type: mimeType || 'image/jpeg' });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('Error in decodePictureFrame:', e);
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

  const version = view.getUint8(3);
  const size = decodeSynchsafe(view.getUint32(6));

  let offset = 10;
  const end = Math.min(size + 10, buffer.byteLength);

  while (offset < end) {
    // Read frame header
    const frameId = getStringFromView(view, offset, 4);

    // Check if we hit padding
    if (frameId === '') {
      break;
    }

    const frameSize = decodeSynchsafe(view.getUint32(offset + 4));

    if (frameSize === 0 || offset + 10 + frameSize > end) {
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
      // Unsynchronized lyrics
      const text = decodeTextFrame(frameData.slice(1)); // Skip language
      if (text) {
        result.lyrics = text;
      }
    } else if (frameId === 'APIC') {
      // Attached picture
      result.coverUrl = decodePictureFrame(frameData);
    }

    offset += 10 + frameSize;
  }

  return result;
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
            // Parse LRC format lyrics
            const parsedLyrics = parseLRCLyrics(value);
            result.lyrics = parsedLyrics.plainText;
            result.syncedLyrics = parsedLyrics.syncedLyrics;
            break;
          case 'TRACKNUMBER':
          case 'TRACK':
            // Could be used for track number, but we don't store it
            break;
        }
      }
    }
  } catch (e) {
    console.error('Error parsing VORBIS_COMMENT:', e);
  }

  return result;
}

// Parse LRC format lyrics (with timestamps like [00:12.34])
function parseLRCLyrics(lrc: string): { plainText: string; syncedLyrics: { time: number; text: string }[] } {
  const lines = lrc.split(/\r?\n/);
  const syncedLyrics: { time: number; text: string }[] = [];
  const plainTextLines: string[] = [];

  // LRC timestamp format: [mm:ss.xx] or [mm:ss]
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Extract all timestamps and text from the line
    const matches = [...trimmedLine.matchAll(timeRegex)];
    const textWithoutTimestamps = trimmedLine.replace(timeRegex, '').trim();

    if (matches.length > 0 && textWithoutTimestamps) {
      // Parse each timestamp and add to synced lyrics
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
    console.error('Error parsing FLAC picture:', e);
    return '';
  }
}

// Export libraryStorage for persistence
export { libraryStorage } from './libraryStorage';

export async function parseAudioFile(file: File): Promise<ParsedMetadata> {
  // Default values
  const defaultResult: ParsedMetadata = {
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: 'Unknown Artist',
    album: 'Unknown Album',
    duration: 0,
    coverUrl: `https://picsum.photos/seed/${encodeURIComponent(file.name)}/1000/1000`,
    lyrics: '',
    audioUrl: URL.createObjectURL(file),
    file
  };

  try {
    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    let metadata: Partial<ParsedMetadata> = {};

    // Parse based on file extension
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.mp3')) {
      metadata = parseID3v2(arrayBuffer);
    } else if (lowerName.endsWith('.m4a') || lowerName.endsWith('.mp4')) {
      metadata = parseMP4(arrayBuffer);
    } else if (lowerName.endsWith('.flac')) {
      metadata = parseFLAC(arrayBuffer);
    }

    // Get duration using Audio element
    const audio = new Audio();
    let durationLoaded = false;
    const durationPromise = new Promise<number>((resolve) => {
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('error', onError);
      };

      const onLoaded = () => {
        cleanup();
        durationLoaded = true;
        resolve(audio.duration || 0);
      };

      const onError = () => {
        cleanup();
        resolve(0);
      };

      audio.addEventListener('loadedmetadata', onLoaded);
      audio.addEventListener('error', onError);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!durationLoaded) {
          cleanup();
          resolve(0);
        }
      }, 5000);
    });

    audio.src = URL.createObjectURL(file);
    const duration = await durationPromise;

    // Clean up the temporary URL
    try {
      URL.revokeObjectURL(audio.src);
    } catch (e) {
      // Ignore errors during cleanup
    }

    return {
      title: metadata.title || defaultResult.title,
      artist: metadata.artist || defaultResult.artist,
      album: metadata.album || defaultResult.album,
      duration: duration || 0,
      coverUrl: metadata.coverUrl || defaultResult.coverUrl,
      lyrics: metadata.lyrics || '',
      syncedLyrics: metadata.syncedLyrics,
      audioUrl: URL.createObjectURL(file),
      file
    };
  } catch (error) {
    console.error("Metadata parsing error:", file.name, error);
    return defaultResult;
  }
}
