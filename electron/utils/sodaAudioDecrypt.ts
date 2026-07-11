/**
 * Soda Music encrypted-MP4 decoder.
 *
 * Derived from the Soda decoder in guohuiyuan/music-lib (AGPL-3.0-or-later):
 * https://github.com/guohuiyuan/music-lib/tree/main/soda
 *
 * LyricsAdapter is GPLv3; this file remains available under AGPL-3.0-or-later
 * to preserve the upstream licence requirements. The decoder is deliberately
 * main-process-only: renderer code must never receive a playback key.
 */
import crypto from 'node:crypto';

interface Mp4Box {
  offset: number;
  size: number;
  headerSize: number;
  type: string;
}

interface Subsample {
  clear: number;
  encrypted: number;
}

interface SampleEncryption {
  iv: Buffer;
  subsamples: Subsample[];
}

function readBox(data: Buffer, start: number, end: number, target: string): Mp4Box | null {
  let offset = start;
  while (offset + 8 <= end && offset + 8 <= data.length) {
    let size = data.readUInt32BE(offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end || offset + 16 > data.length) return null;
      const extendedSize = data.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end || offset + size > data.length) return null;
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (type === target) return { offset, size, headerSize, type };
    offset += size;
  }
  return null;
}

function childOffset(box: Mp4Box): number | null {
  switch (box.type) {
    case 'moov':
    case 'trak':
    case 'mdia':
    case 'minf':
    case 'stbl':
    case 'sinf':
    case 'schi':
      return box.offset + box.headerSize;
    case 'stsd':
      return box.offset + box.headerSize + 8;
    case 'enca':
    case 'mp4a':
    case 'alac':
    case 'fLaC':
      return box.offset + box.headerSize + 28;
    default:
      return null;
  }
}

function findBoxDeep(data: Buffer, target: string, start: number, end: number): Mp4Box | null {
  let offset = start;
  while (offset + 8 <= end && offset + 8 <= data.length) {
    let size = data.readUInt32BE(offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end || offset + 16 > data.length) return null;
      const extendedSize = data.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end || offset + size > data.length) return null;

    const type = data.toString('ascii', offset + 4, offset + 8);
    const box: Mp4Box = { offset, size, headerSize, type };
    if (type === target) return box;
    const childrenStart = childOffset(box);
    if (childrenStart !== null && childrenStart < offset + size) {
      const nested = findBoxDeep(data, target, childrenStart, offset + size);
      if (nested) return nested;
    }
    offset += size;
  }
  return null;
}

function boxPayload(data: Buffer, box: Mp4Box): Buffer {
  return data.subarray(box.offset + box.headerSize, box.offset + box.size);
}

function parseSampleSizes(data: Buffer): number[] {
  if (data.length < 12) return [];
  const fixedSize = data.readUInt32BE(4);
  const count = data.readUInt32BE(8);
  if (count > 1_000_000) return [];
  if (fixedSize !== 0) return Array.from({ length: count }, () => fixedSize);

  const sizes: number[] = [];
  for (let index = 0; index < count && 12 + index * 4 + 4 <= data.length; index += 1) {
    sizes.push(data.readUInt32BE(12 + index * 4));
  }
  return sizes;
}

function perSampleIvSize(data: Buffer, stbl: Mp4Box): number {
  const tenc = findBoxDeep(data, 'tenc', stbl.offset + stbl.headerSize, stbl.offset + stbl.size);
  if (!tenc) return 8;
  const payload = boxPayload(data, tenc);
  const size = payload.length >= 8 ? payload[7] : undefined;
  return size === 8 || size === 16 ? size : 8;
}

function parseSampleEncryption(data: Buffer, ivSize: number): SampleEncryption[] {
  if (data.length < 8) return [];
  const flags = data.readUInt32BE(0) & 0x00ffffff;
  const count = data.readUInt32BE(4);
  if (count > 1_000_000) return [];
  const hasSubsamples = (flags & 0x02) !== 0;
  const samples: SampleEncryption[] = [];
  let offset = 8;

  for (let index = 0; index < count; index += 1) {
    if (offset + ivSize > data.length) break;
    const iv = Buffer.from(data.subarray(offset, offset + ivSize));
    offset += ivSize;
    const subsamples: Subsample[] = [];
    if (hasSubsamples) {
      if (offset + 2 > data.length) break;
      const count = data.readUInt16BE(offset);
      offset += 2;
      if (offset + count * 6 > data.length) break;
      for (let subIndex = 0; subIndex < count; subIndex += 1) {
        subsamples.push({
          clear: data.readUInt16BE(offset),
          encrypted: data.readUInt32BE(offset + 2),
        });
        offset += 6;
      }
    }
    samples.push({ iv, subsamples });
  }
  return samples;
}

function bitCount(input: number): number {
  let value = input >>> 0;
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function decodeBase36(value: number): number {
  if (value >= 48 && value <= 57) return value - 48;
  if (value >= 97 && value <= 122) return value - 97 + 10;
  return 0xff;
}

function decodeSpadeKey(playAuth: string): Buffer {
  const auth = Buffer.from(playAuth, 'base64');
  if (auth.length < 3) throw new Error('Soda playback authorization is invalid');
  const paddingLength = (auth[0]! ^ auth[1]! ^ auth[2]!) - 48;
  if (paddingLength < 0 || auth.length < paddingLength + 2) {
    throw new Error('Soda playback authorization has invalid padding');
  }

  const encrypted = auth.subarray(1, auth.length - paddingLength);
  const prefixed = Buffer.concat([Buffer.from([0xfa, 0x55]), encrypted]);
  const decrypted = Buffer.allocUnsafe(encrypted.length);
  for (let index = 0; index < encrypted.length; index += 1) {
    let value = (encrypted[index]! ^ prefixed[index]!) - bitCount(index) - 21;
    while (value < 0) value += 255;
    decrypted[index] = value;
  }

  const skipped = decodeBase36(decrypted[0]!);
  const end = 1 + (auth.length - paddingLength - 2) - skipped;
  if (end < 1 || end > decrypted.length) {
    throw new Error('Soda playback authorization has an invalid key range');
  }
  const key = Buffer.from(decrypted.subarray(1, end).toString('utf8'), 'hex');
  if (![16, 24, 32].includes(key.length)) {
    throw new Error('Soda playback authorization has an unsupported key');
  }
  return key;
}

function decryptSample(key: Buffer, encrypted: Buffer, sample: SampleEncryption): Buffer {
  const iv = Buffer.alloc(16);
  sample.iv.copy(iv);
  const decipher = crypto.createDecipheriv(`aes-${key.length * 8}-ctr`, key, iv);
  const output = Buffer.allocUnsafe(encrypted.length);

  if (sample.subsamples.length === 0) {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  let offset = 0;
  for (const subsample of sample.subsamples) {
    const clearEnd = Math.min(offset + subsample.clear, encrypted.length);
    encrypted.copy(output, offset, offset, clearEnd);
    offset = clearEnd;
    if (offset >= encrypted.length) break;

    const encryptedEnd = Math.min(offset + subsample.encrypted, encrypted.length);
    decipher.update(encrypted.subarray(offset, encryptedEnd)).copy(output, offset);
    offset = encryptedEnd;
    if (offset >= encrypted.length) break;
  }
  if (offset < encrypted.length) encrypted.copy(output, offset);
  decipher.final();
  return output;
}

function restoreSampleFormat(data: Buffer, stsd: Mp4Box): void {
  const payloadStart = stsd.offset + stsd.headerSize;
  const payload = data.subarray(payloadStart, stsd.offset + stsd.size);
  const encryptedFormatOffset = payload.indexOf('enca');
  const originalFormatMarker = payload.indexOf('frma');
  if (encryptedFormatOffset < 0 || originalFormatMarker < 4 || originalFormatMarker + 8 > payload.length) return;
  const atomSize = payload.readUInt32BE(originalFormatMarker - 4);
  if (atomSize < 12 || originalFormatMarker - 4 + atomSize > payload.length) return;
  payload.copy(payload, encryptedFormatOffset, originalFormatMarker + 4, originalFormatMarker + 8);
}

/** Decrypt a Soda encrypted-MP4 payload into browser-playable audio bytes. */
export function decryptSodaAudio(encryptedAudio: Buffer, playAuth: string): Buffer {
  const key = decodeSpadeKey(playAuth);
  const moov = readBox(encryptedAudio, 0, encryptedAudio.length, 'moov');
  const mdat = readBox(encryptedAudio, 0, encryptedAudio.length, 'mdat');
  if (!moov || !mdat) throw new Error('Soda audio is missing required MP4 atoms');

  const stbl = findBoxDeep(encryptedAudio, 'stbl', moov.offset + moov.headerSize, moov.offset + moov.size);
  if (!stbl) throw new Error('Soda audio is missing the sample table');
  const stsz = findBoxDeep(encryptedAudio, 'stsz', stbl.offset + stbl.headerSize, stbl.offset + stbl.size);
  const senc = findBoxDeep(encryptedAudio, 'senc', moov.offset + moov.headerSize, moov.offset + moov.size);
  if (!stsz || !senc) throw new Error('Soda audio is missing encryption metadata');

  const sizes = parseSampleSizes(boxPayload(encryptedAudio, stsz));
  const samples = parseSampleEncryption(boxPayload(encryptedAudio, senc), perSampleIvSize(encryptedAudio, stbl));
  if (sizes.length === 0 || samples.length === 0) throw new Error('Soda audio has no decryptable samples');

  const decrypted = Buffer.from(encryptedAudio);
  const payloadStart = mdat.offset + mdat.headerSize;
  const payloadEnd = mdat.offset + mdat.size;
  let offset = payloadStart;
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index]!;
    if (offset + size > payloadEnd) break;
    const sample = samples[index];
    if (sample) decryptSample(key, decrypted.subarray(offset, offset + size), sample).copy(decrypted, offset);
    offset += size;
  }
  if (offset !== payloadEnd) throw new Error('Soda audio sample sizes do not match media data');

  const stsd = findBoxDeep(decrypted, 'stsd', stbl.offset + stbl.headerSize, stbl.offset + stbl.size);
  if (stsd) restoreSampleFormat(decrypted, stsd);
  return decrypted;
}
