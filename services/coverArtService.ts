/**
 * Cover Art Service
 * Handles extracting cover art from audio file metadata and caching in IndexedDB
 * Replaces online cover URLs with locally extracted covers
 */

import { indexedDBStorage } from './indexedDBStorage';
import { getDesktopAPIAsync } from './desktopAdapter';
import { logger } from './logger';

class CoverArtService {
  private coverUrlCache: Map<string, string> = new Map(); // trackId -> blob URL
  private processingQueue: Set<string> = new Set();

  /**
   * Get cover art for a track
   * Returns cached blob URL if available, otherwise returns placeholder
   * and triggers background extraction
   */
  async getCoverUrl(track: {
    id: string;
    filePath?: string;
    coverUrl?: string;
  }): Promise<string> {
    const { id, filePath, coverUrl } = track;

    // Check if we already have a cached blob URL for this track
    const cachedUrl = this.coverUrlCache.get(id);
    if (cachedUrl) {
      return cachedUrl;
    }

    // Check if we have the cover in IndexedDB
    try {
      const blob = await indexedDBStorage.getCover(id);
      if (blob) {
        const blobUrl = URL.createObjectURL(blob);
        this.coverUrlCache.set(id, blobUrl);
        return blobUrl;
      }
    } catch (error) {
      logger.warn(`[CoverArtService] Failed to get cover from IndexedDB for ${id}:`, error);
    }

    // If we have a file path, try to extract cover from file metadata
    if (filePath) {
      // Trigger background extraction
      this.extractAndCacheCover(id, filePath).catch(error => {
        logger.warn(`[CoverArtService] Background cover extraction failed for ${id}:`, error);
      });
    }

    // Return the original coverUrl (could be online URL or placeholder) as fallback
    return coverUrl || this.getPlaceholderUrl(id);
  }

  /**
   * Extract cover from audio file and cache it
   */
  async extractAndCacheCover(trackId: string, filePath: string): Promise<string | null> {
    // Prevent duplicate processing
    if (this.processingQueue.has(trackId)) {
      logger.debug(`[CoverArtService] Cover extraction already in progress for ${trackId}`);
      return null;
    }

    this.processingQueue.add(trackId);

    try {
      logger.debug(`[CoverArtService] Extracting cover from file: ${filePath}`);

      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) {
        throw new Error('Desktop API not available');
      }

      // Read file and parse metadata
      const readResult = await desktopAPI.readFile(filePath);
      if (!readResult.success || !readResult.data) {
        throw new Error(`Failed to read file: ${readResult.error}`);
      }

      // Determine file type from extension
      const fileName = filePath.split(/[/\\]/).pop() || 'audio.flac';
      const ext = fileName.split('.').pop()?.toLowerCase() || 'flac';
      const mimeType = this.getMimeTypeFromExt(ext);

      // Parse metadata to extract cover
      const file = new File([readResult.data], fileName, { type: mimeType });
      const arrayBuffer = await file.arrayBuffer();

      // Extract cover data from metadata
      const coverData = await this.extractCoverFromBuffer(arrayBuffer, ext);

      if (coverData) {
        // Save to IndexedDB
        await indexedDBStorage.setCover(trackId, coverData.blob);

        // Create and cache blob URL
        const blobUrl = URL.createObjectURL(coverData.blob);
        this.coverUrlCache.set(trackId, blobUrl);

        logger.debug(`[CoverArtService] ✓ Cover extracted and cached for ${trackId} (${(coverData.blob.size / 1024).toFixed(2)} KB)`);
        return blobUrl;
      } else {
        logger.debug(`[CoverArtService] No cover found in file metadata for ${trackId}`);
      }

      return null;
    } catch (error) {
      logger.error(`[CoverArtService] Failed to extract cover for ${trackId}:`, error);
      return null;
    } finally {
      this.processingQueue.delete(trackId);
    }
  }

  /**
   * Extract cover from audio file buffer
   * Supports FLAC (PICTURE block), MP3 (APIC frame), and M4A
   */
  private async extractCoverFromBuffer(
    buffer: ArrayBuffer,
    ext: string
  ): Promise<{ blob: Blob; mimeType: string } | null> {
    try {
      if (ext === 'flac') {
        return this.extractCoverFromFLAC(buffer);
      } else if (ext === 'mp3') {
        return this.extractCoverFromMP3(buffer);
      } else if (ext === 'm4a' || ext === 'mp4') {
        return this.extractCoverFromM4A(buffer);
      }
      return null;
    } catch (error) {
      logger.warn(`[CoverArtService] Error extracting cover:`, error);
      return null;
    }
  }

  /**
   * Extract cover from FLAC file (PICTURE block)
   */
  private extractCoverFromFLAC(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);

    // Check FLAC signature
    const signature = this.getStringFromView(view, 0, 4);
    if (signature !== 'fLaC') {
      return null;
    }

    let offset = 4;

    // Parse metadata blocks
    while (offset < buffer.byteLength - 4) {
      const header = view.getUint8(offset);
      const isLast = (header & 0x80) !== 0;
      const blockType = header & 0x7F;

      // Block size is 3 bytes (big endian)
      const blockSize = (view.getUint8(offset + 1) << 16) |
                       (view.getUint8(offset + 2) << 8) |
                       (view.getUint8(offset + 3));

      offset += 4;

      if (blockType === 6) {
        // PICTURE block
        return this.parseFLACPictureBlock(buffer.slice(offset, offset + blockSize));
      }

      offset += blockSize;

      if (isLast) break;
    }

    return null;
  }

  /**
   * Parse FLAC PICTURE block
   */
  private parseFLACPictureBlock(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);
    let offset = 0;

    try {
      // Picture type (4 bytes, big endian) - skip
      offset += 4;

      // MIME type length (4 bytes, big endian)
      const mimeTypeLength = view.getUint32(offset, false);
      offset += 4;

      // MIME type (UTF-8)
      const mimeTypeBytes = buffer.slice(offset, offset + mimeTypeLength);
      const mimeType = new TextDecoder('utf-8').decode(mimeTypeBytes);
      offset += mimeTypeLength;

      // Description length (4 bytes, big endian)
      const descriptionLength = view.getUint32(offset, false);
      offset += 4;

      // Skip description
      offset += descriptionLength;

      // Skip width, height, color depth, color count (4 bytes each)
      offset += 16;

      // Picture data length (4 bytes, big endian)
      const pictureDataLength = view.getUint32(offset, false);
      offset += 4;

      // Picture data
      const pictureData = buffer.slice(offset, offset + pictureDataLength);

      return {
        blob: new Blob([pictureData], { type: mimeType || 'image/jpeg' }),
        mimeType: mimeType || 'image/jpeg'
      };
    } catch (e) {
      logger.warn('[CoverArtService] Error parsing FLAC picture block:', e);
      return null;
    }
  }

  /**
   * Extract cover from MP3 file (APIC frame in ID3v2)
   */
  private extractCoverFromMP3(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);

    // Check ID3v2 header
    const header = this.getStringFromView(view, 0, 3);
    if (header !== 'ID3') {
      return null;
    }

    const version = view.getUint8(3);
    const size = this.decodeSynchsafe(view.getUint32(6));

    let offset = 10;
    const end = Math.min(size + 10, buffer.byteLength);

    while (offset < end) {
      // Read frame header
      const frameId = this.getStringFromView(view, offset, 4);

      if (frameId === '') {
        break;
      }

      const frameSize = this.decodeSynchsafe(view.getUint32(offset + 4));

      if (frameSize === 0 || offset + 10 + frameSize > end) {
        break;
      }

      if (frameId === 'APIC') {
        // Attached picture frame
        return this.parseAPICFrame(buffer.slice(offset + 10, offset + 10 + frameSize));
      }

      offset += 10 + frameSize;
    }

    return null;
  }

  /**
   * Parse APIC (Attached Picture) frame from ID3v2
   */
  private parseAPICFrame(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);
    let offset = 0;

    try {
      // Read encoding byte
      const encoding = view.getUint8(offset);
      offset += 1;

      // Read MIME type (null terminated)
      let mimeTypeEnd = offset;
      while (mimeTypeEnd < buffer.byteLength && view.getUint8(mimeTypeEnd) !== 0) {
        mimeTypeEnd++;
      }
      const mimeType = this.getStringFromView(view, offset, mimeTypeEnd - offset);
      offset = mimeTypeEnd + 1;

      // Skip picture type (1 byte)
      offset += 1;

      // Skip description (null terminated, encoding dependent)
      if (encoding === 0 || encoding === 3) {
        // ISO-8859-1 or UTF-8
        while (offset < buffer.byteLength && view.getUint8(offset) !== 0) {
          offset++;
        }
        offset += 1;
      } else {
        // UTF-16
        while (offset < buffer.byteLength - 1) {
          if (view.getUint8(offset) === 0 && view.getUint8(offset + 1) === 0) {
            offset += 2;
            break;
          }
          offset++;
        }
      }

      // The rest is image data
      const imageData = buffer.slice(offset);

      return {
        blob: new Blob([imageData], { type: mimeType || 'image/jpeg' }),
        mimeType: mimeType || 'image/jpeg'
      };
    } catch (e) {
      logger.warn('[CoverArtService] Error parsing APIC frame:', e);
      return null;
    }
  }

  /**
   * Extract cover from M4A/MP4 file
   * Simplified implementation - looks for 'covr' atom
   */
  private extractCoverFromM4A(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    // M4A parsing is complex, this is a simplified version
    // For full support, would need a complete MP4 parser
    const view = new DataView(buffer);

    // Look for 'covr' atom which contains cover art
    const searchForCovr = (start: number, end: number): { blob: Blob; mimeType: string } | null => {
      let offset = start;

      while (offset < end - 8) {
        const atomSize = view.getUint32(offset, false);
        const atomType = this.getStringFromView(view, offset + 4, 4);

        if (atomSize === 0) break;
        if (atomSize === 1) break; // Extended size not supported in this simple parser

        if (atomType === 'covr') {
          // Found cover atom
          // Skip atom header (8 bytes) and data atom header (8 bytes)
          // Data atom starts after 'covr' header
          const dataOffset = offset + 8;
          const dataType = view.getUint32(dataOffset + 8, false); // Data type indicator

          // Image data starts after atom headers and type indicator
          const imageOffset = dataOffset + 16;
          const imageSize = atomSize - 16;

          // Determine MIME type from data type
          // 13 = JPEG, 14 = PNG
          const mimeType = dataType === 14 ? 'image/png' : 'image/jpeg';

          const imageData = buffer.slice(imageOffset, imageOffset + imageSize);
          return {
            blob: new Blob([imageData], { type: mimeType }),
            mimeType
          };
        }

        // Check children if this is a container atom
        if (['moov', 'udta', 'meta', 'ilst'].includes(atomType)) {
          const childStart = offset + (atomType === 'meta' ? 12 : 8); // 'meta' has extra version/flags
          const childEnd = offset + atomSize;
          const result = searchForCovr(childStart, childEnd);
          if (result) return result;
        }

        offset += atomSize;
      }

      return null;
    };

    try {
      return searchForCovr(0, Math.min(buffer.byteLength, 10 * 1024 * 1024)); // Limit to first 10MB
    } catch (e) {
      logger.warn('[CoverArtService] Error parsing M4A cover:', e);
      return null;
    }
  }

  /**
   * Decode synchsafe integer (used in ID3v2)
   */
  private decodeSynchsafe(value: number): number {
    const out = [];
    out.push(value & 0x7F);
    out.push((value >> 8) & 0x7F);
    out.push((value >> 16) & 0x7F);
    out.push((value >> 24) & 0x7F);
    return (out[0] << 21) | (out[1] << 14) | (out[2] << 7) | out[3];
  }

  /**
   * Get string from DataView
   */
  private getStringFromView(view: DataView, offset: number, length: number): string {
    let str = '';
    for (let i = 0; i < length; i++) {
      const char = view.getUint8(offset + i);
      if (char > 0) {
        str += String.fromCharCode(char);
      }
    }
    return str;
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeTypeFromExt(ext: string): string {
    switch (ext) {
      case 'mp3': return 'audio/mpeg';
      case 'flac': return 'audio/flac';
      case 'm4a': return 'audio/mp4';
      case 'wav': return 'audio/wav';
      default: return 'audio/flac';
    }
  }

  /**
   * Get placeholder image URL
   */
  private getPlaceholderUrl(trackId: string): string {
    return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="10">♪</text></svg>`;
  }

  /**
   * Preload covers for multiple tracks
   */
  async preloadCovers(tracks: Array<{ id: string; filePath?: string }>): Promise<void> {
    const promises = tracks
      .filter(track => track.filePath && !this.coverUrlCache.has(track.id))
      .map(track => this.extractAndCacheCover(track.id, track.filePath!));

    await Promise.allSettled(promises);
  }

  /**
   * Clear all cached blob URLs
   */
  revokeAllBlobUrls(): void {
    this.coverUrlCache.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        // Ignore errors
      }
    });
    this.coverUrlCache.clear();
    logger.debug('[CoverArtService] ✓ All cached blob URLs revoked');
  }

  /**
   * Delete cover from cache and IndexedDB
   */
  async deleteCover(trackId: string): Promise<void> {
    const cachedUrl = this.coverUrlCache.get(trackId);
    if (cachedUrl) {
      URL.revokeObjectURL(cachedUrl);
      this.coverUrlCache.delete(trackId);
    }
    await indexedDBStorage.deleteCover(trackId);
  }
}

export const coverArtService = new CoverArtService();
