// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeLyricsFile, readSidecarLyrics } from '../../../../electron/services/metadata/sidecarLyrics';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'la-sidecar-')); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

const LRC = '[00:01.00]第一行\n[00:05.50]second line';
/** "晴天" in GBK, as older Chinese lyric files store it. */
const GBK_QINGTIAN = [0xc7, 0xe7, 0xcc, 0xec];

describe('sidecar lyrics', () => {
  it('reads the lyric file that shares the audio file name', async () => {
    const audio = path.join(directory, 'Artist - Song.v2.flac');
    await fs.writeFile(path.join(directory, 'Artist - Song.v2.lrc'), `\n${LRC}\n`);
    await fs.writeFile(path.join(directory, 'Other.lrc'), '[00:00.00]other');
    expect(readSidecarLyrics(audio)).toBe(LRC);
  });

  it('finds nothing without a lyric file, or with an empty or oversized one', async () => {
    expect(readSidecarLyrics(path.join(directory, 'Missing.mp3'))).toBeUndefined();
    await fs.writeFile(path.join(directory, 'Empty.lrc'), '  \n');
    expect(readSidecarLyrics(path.join(directory, 'Empty.mp3'))).toBeUndefined();
    await fs.writeFile(path.join(directory, 'Huge.lrc'), 'x'.repeat(600 * 1024));
    expect(readSidecarLyrics(path.join(directory, 'Huge.mp3'))).toBeUndefined();
  });

  it('does not take a folder named like a lyric file for one', async () => {
    await fs.mkdir(path.join(directory, 'Song.lrc'));
    expect(readSidecarLyrics(path.join(directory, 'Song.mp3'))).toBeUndefined();
  });

  it('decodes UTF-8 with or without a byte order mark, UTF-16 and GBK', () => {
    expect(decodeLyricsFile(Buffer.from('晴天', 'utf8'))).toBe('晴天');
    expect(decodeLyricsFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('晴天', 'utf8')]))).toBe('晴天');
    expect(decodeLyricsFile(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('晴天', 'utf16le')]))).toBe('晴天');
    expect(decodeLyricsFile(Buffer.from(GBK_QINGTIAN))).toBe('晴天');
  });
});
