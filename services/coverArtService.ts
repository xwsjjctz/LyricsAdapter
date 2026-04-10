import { getDesktopAPIAsync } from './desktopAdapter';
import { logger } from './logger';

class CoverArtService {
  private processingQueue: Set<string> = new Set();

  async getCoverUrl(track: {
    id: string;
    filePath?: string;
    coverUrl?: string;
  }): Promise<string> {
    const { id, filePath, coverUrl } = track;

    if (coverUrl && coverUrl.startsWith('cover://')) {
      return coverUrl;
    }

    if (filePath) {
      this.extractAndCacheCover(id, filePath).catch(error => {
        logger.warn(`[CoverArtService] Background cover extraction failed for ${id}:`, error);
      });
    }

    return coverUrl || this.getPlaceholderUrl(id);
  }

  async extractAndCacheCover(trackId: string, filePath: string): Promise<string | null> {
    if (this.processingQueue.has(trackId)) {
      return null;
    }

    this.processingQueue.add(trackId);

    try {
      logger.debug(`[CoverArtService] Extracting cover from file: ${filePath}`);

      const desktopAPI = await getDesktopAPIAsync();
      if (!desktopAPI) {
        throw new Error('Desktop API not available');
      }

      const readResult = await desktopAPI.readFile(filePath);
      if (!readResult.success || !readResult.data) {
        throw new Error(`Failed to read file: ${readResult.error}`);
      }

      const fileName = filePath.split(/[/\\]/).pop() || 'audio.flac';
      const ext = fileName.split('.').pop()?.toLowerCase() || 'flac';
      const mimeType = this.getMimeTypeFromExt(ext);

      const file = new File([readResult.data], fileName, { type: mimeType });
      const arrayBuffer = await file.arrayBuffer();

      const coverData = await this.extractCoverFromBuffer(arrayBuffer, ext);

      if (coverData) {
        if (desktopAPI.saveCoverThumbnail) {
          const base64 = await this.blobToBase64(coverData.blob);
          const coverResult = await desktopAPI.saveCoverThumbnail({
            id: trackId,
            data: base64,
            mime: coverData.mimeType,
          });

          if (coverResult?.success && coverResult.coverUrl) {
            logger.debug(`[CoverArtService] ✓ Cover saved to disk for ${trackId} (${(coverData.blob.size / 1024).toFixed(2)} KB)`);
            return coverResult.coverUrl;
          }
        }

        logger.debug(`[CoverArtService] ✓ Cover extracted for ${trackId} but not saved to disk`);
        return null;
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

  async deleteCover(trackId: string): Promise<void> {
    try {
      const desktopAPI = await getDesktopAPIAsync();
      if (desktopAPI?.deleteCoverThumbnail) {
        await desktopAPI.deleteCoverThumbnail(trackId);
        logger.debug(`[CoverArtService] ✓ Deleted cover for ${trackId}`);
      }
    } catch (error) {
      logger.error(`[CoverArtService] Failed to delete cover for ${trackId}:`, error);
    }
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

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

  private extractCoverFromFLAC(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);

    const signature = this.getStringFromView(view, 0, 4);
    if (signature !== 'fLaC') {
      return null;
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

      if (blockType === 6) {
        return this.parseFLACPictureBlock(buffer.slice(offset, offset + blockSize));
      }

      offset += blockSize;

      if (isLast) break;
    }

    return null;
  }

  private parseFLACPictureBlock(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);
    let offset = 0;

    try {
      offset += 4;

      const mimeTypeLength = view.getUint32(offset, false);
      offset += 4;

      const mimeTypeBytes = buffer.slice(offset, offset + mimeTypeLength);
      const mimeType = new TextDecoder('utf-8').decode(mimeTypeBytes);
      offset += mimeTypeLength;

      const descriptionLength = view.getUint32(offset, false);
      offset += 4;

      offset += descriptionLength;

      offset += 16;

      const pictureDataLength = view.getUint32(offset, false);
      offset += 4;

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

  private extractCoverFromMP3(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);

    const header = this.getStringFromView(view, 0, 3);
    if (header !== 'ID3') {
      return null;
    }

    const size = this.decodeSynchsafe(view.getUint32(6));

    let offset = 10;
    const end = Math.min(size + 10, buffer.byteLength);

    while (offset < end) {
      const frameId = this.getStringFromView(view, offset, 4);

      if (frameId === '') {
        break;
      }

      const frameSize = this.decodeSynchsafe(view.getUint32(offset + 4));

      if (frameSize === 0 || offset + 10 + frameSize > end) {
        break;
      }

      if (frameId === 'APIC') {
        return this.parseAPICFrame(buffer.slice(offset + 10, offset + 10 + frameSize));
      }

      offset += 10 + frameSize;
    }

    return null;
  }

  private parseAPICFrame(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);
    let offset = 0;

    try {
      const encoding = view.getUint8(offset);
      offset += 1;

      let mimeTypeEnd = offset;
      while (mimeTypeEnd < buffer.byteLength && view.getUint8(mimeTypeEnd) !== 0) {
        mimeTypeEnd++;
      }
      const mimeType = this.getStringFromView(view, offset, mimeTypeEnd - offset);
      offset = mimeTypeEnd + 1;

      offset += 1;

      if (encoding === 0 || encoding === 3) {
        while (offset < buffer.byteLength && view.getUint8(offset) !== 0) {
          offset++;
        }
        offset += 1;
      } else {
        while (offset < buffer.byteLength - 1) {
          if (view.getUint8(offset) === 0 && view.getUint8(offset + 1) === 0) {
            offset += 2;
            break;
          }
          offset++;
        }
      }

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

  private extractCoverFromM4A(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null {
    const view = new DataView(buffer);

    const searchForCovr = (start: number, end: number): { blob: Blob; mimeType: string } | null => {
      let offset = start;

      while (offset < end - 8) {
        const atomSize = view.getUint32(offset, false);
        const atomType = this.getStringFromView(view, offset + 4, 4);

        if (atomSize === 0) break;
        if (atomSize === 1) break;

        if (atomType === 'covr') {
          const dataOffset = offset + 8;
          const dataType = view.getUint32(dataOffset + 8, false);

          const imageOffset = dataOffset + 16;
          const imageSize = atomSize - 16;

          const mimeType = dataType === 14 ? 'image/png' : 'image/jpeg';

          const imageData = buffer.slice(imageOffset, imageOffset + imageSize);
          return {
            blob: new Blob([imageData], { type: mimeType }),
            mimeType
          };
        }

        if (['moov', 'udta', 'meta', 'ilst'].includes(atomType)) {
          const childStart = offset + (atomType === 'meta' ? 12 : 8);
          const childEnd = offset + atomSize;
          const result = searchForCovr(childStart, childEnd);
          if (result) return result;
        }

        offset += atomSize;
      }

      return null;
    };

    try {
      return searchForCovr(0, Math.min(buffer.byteLength, 10 * 1024 * 1024));
    } catch (e) {
      logger.warn('[CoverArtService] Error parsing M4A cover:', e);
      return null;
    }
  }

  private decodeSynchsafe(value: number): number {
    const out = [];
    out.push(value & 0x7F);
    out.push((value >> 8) & 0x7F);
    out.push((value >> 16) & 0x7F);
    out.push((value >> 24) & 0x7F);
    return (out[0] << 21) | (out[1] << 14) | (out[2] << 7) | out[3];
  }

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

  private getMimeTypeFromExt(ext: string): string {
    switch (ext) {
      case 'mp3': return 'audio/mpeg';
      case 'flac': return 'audio/flac';
      case 'm4a': return 'audio/mp4';
      case 'wav': return 'audio/wav';
      default: return 'audio/flac';
    }
  }

  private getPlaceholderUrl(trackId: string): string {
    return `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-size="10">♪</text></svg>`;
  }

  async preloadCovers(tracks: Array<{ id: string; filePath?: string }>): Promise<void> {
    const promises = tracks
      .filter(track => track.filePath)
      .map(track => this.extractAndCacheCover(track.id, track.filePath!));

    await Promise.allSettled(promises);
  }
}

export const coverArtService = new CoverArtService();
