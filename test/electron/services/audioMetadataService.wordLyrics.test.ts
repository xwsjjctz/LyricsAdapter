// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }));
vi.mock('../../../electron/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { writeAudioMetadata } from '../../../electron/services/audioMetadataService';
import { readVorbisField } from '../../../electron/services/flacVorbisWriter';

const QRC = '<QrcInfos><Lyric_1 LyricType="1" LyricContent="[0,500]晴(0,500)"/></QrcInfos>';
const YRC = '[0,500](0,500,0)晴';

const UNCHANGED = {
  title: undefined,
  artist: undefined,
  album: undefined,
  lyrics: undefined,
  wordLyrics: undefined,
  wordLyricsFormat: undefined,
  coverDataUri: undefined,
} as const;

function metadataBlock(type: number, body: Buffer, isLast: boolean): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (isLast ? 0x80 : 0) | type;
  header.writeUIntBE(body.length, 1, 3);
  return Buffer.concat([header, body]);
}

/** 2 s of 44.1 kHz 16-bit stereo; a tag write needs no audio frames. */
function streamInfo(): Buffer {
  const body = Buffer.alloc(34);
  body.writeUInt16BE(4096, 0);
  body.writeUInt16BE(4096, 2);
  const sampleRate = 44_100n;
  const channels = 2n;
  const bitsPerSample = 16n;
  const totalSamples = 88_200n;
  body.writeBigUInt64BE((sampleRate << 44n) | ((channels - 1n) << 41n) | ((bitsPerSample - 1n) << 36n) | totalSamples, 10);
  return body;
}

function vorbisComments(comments: string[]): Buffer {
  const lengthPrefixed = (text: string) => {
    const bytes = Buffer.from(text, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([length, bytes]);
  };
  const count = Buffer.alloc(4);
  count.writeUInt32LE(comments.length, 0);
  return Buffer.concat([lengthPrefixed('reference libFLAC 1.4.3'), count, ...comments.map(lengthPrefixed)]);
}

describe('writeAudioMetadata and stored word lyrics', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  });

  function flacWith(comments: string[]): string {
    directory = mkdtempSync(path.join(tmpdir(), 'la-word-lyrics-'));
    const file = path.join(directory, 'track.flac');
    writeFileSync(file, Buffer.concat([
      Buffer.from('fLaC', 'ascii'),
      metadataBlock(0, streamInfo(), false),
      metadataBlock(4, vorbisComments(comments), true),
    ]));
    return file;
  }

  it('keeps QRC and YRC in a FLAC when only the common fields change', async () => {
    const file = flacWith(['TITLE=晴天', `QRC=${QRC}`, `YRC=${YRC}`]);

    await writeAudioMetadata(file, { ...UNCHANGED, title: '七里香' });

    expect(readVorbisField(file, 'TITLE')).toBe('七里香');
    expect(readVorbisField(file, 'QRC')).toBe(QRC);
    expect(readVorbisField(file, 'YRC')).toBe(YRC);
  });

  it('replaces only the word-lyrics format being written', async () => {
    const file = flacWith(['TITLE=晴天', `QRC=${QRC}`, `YRC=${YRC}`]);

    await writeAudioMetadata(file, { ...UNCHANGED, title: '七里香', wordLyrics: '[0,500]香(0,500)', wordLyricsFormat: 'qrc' });

    expect(readVorbisField(file, 'QRC')).toBe('[0,500]香(0,500)');
    expect(readVorbisField(file, 'YRC')).toBe(YRC);
  });
});
