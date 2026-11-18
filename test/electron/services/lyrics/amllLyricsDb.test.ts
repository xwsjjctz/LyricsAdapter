// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmllLyricsDb, parseAmllIndex } from '../../../../electron/services/lyrics/amllLyricsDb';

const OFFICIAL = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main';
const INDEX = 'metadata/raw-lyrics-index.jsonl';

const line = (metadata: Record<string, string[]>) =>
  JSON.stringify({ metadata: Object.entries(metadata), rawLyricFile: 'raw.ttml' });

const INDEX_TEXT = [
  line({ musicName: ['Idol'], artists: ['YOASOBI'], album: ['Idol'], ncmMusicId: ['111'] }),
  line({ musicName: ['ラグトレイン', 'Lagtrain'], artists: ['稲葉曇', '歌愛ユキ'], album: ['ウェザーステーション'], qqMusicId: ['003abc'] }),
  line({ musicName: ['Idol'], artists: ['Other Singer'], album: ['Covers'], ncmMusicId: ['222'] }),
  'not json',
  line({ musicName: ['No Platform'], artists: ['Nobody'] }),
  line({ musicName: ['Unsafe'], artists: ['Nobody'], ncmMusicId: ['../../etc'] }),
].join('\n');

const YRC = '[0,1000](0,500,0)Hel(500,500,0)lo';
const LRC = '[00:00.00]Hello';

let directory: string;
beforeEach(async () => { directory = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'la-amll-')), 'community-lyrics'); });
afterEach(async () => { await fs.rm(path.dirname(directory), { recursive: true, force: true }); });

/** A fetcher serving the given paths from the repository; everything else is missing. */
function serving(files: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const body = url.startsWith(`${OFFICIAL}/`) ? files[url.slice(OFFICIAL.length + 1)] : undefined;
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
  });
}

describe('parseAmllIndex', () => {
  it('lists songs by every title, skipping lines without a usable platform id', () => {
    const index = parseAmllIndex(INDEX_TEXT);
    expect(index.get('idol')?.map(entry => entry.lyricPath)).toEqual(['ncm-lyrics/222', 'ncm-lyrics/111']);
    expect(index.get('lagtrain')?.[0]).toMatchObject({ lyricPath: 'qq-lyrics/003abc', artists: ['稲葉曇', '歌愛ユキ'] });
    expect(index.has('noplatform')).toBe(false);
    expect(index.has('unsafe')).toBe(false);
  });

  it('keeps only the newest entry of a song that was revised', () => {
    const index = parseAmllIndex([
      line({ musicName: ['Old Name'], artists: ['A'], ncmMusicId: ['7'] }),
      line({ musicName: ['New Name'], artists: ['A'], ncmMusicId: ['7'] }),
    ].join('\n'));
    expect(index.has('oldname')).toBe(false);
    expect(index.get('newname')).toHaveLength(1);
  });
});

describe('AmllLyricsDb', () => {
  it('matches by title and artist and returns the word-by-word and line lyrics', async () => {
    const fetcher = serving({ [INDEX]: INDEX_TEXT, 'ncm-lyrics/111.yrc': YRC, 'ncm-lyrics/111.lrc': LRC });
    const db = new AmllLyricsDb({ directory, fetcher });

    expect(await db.match({ title: 'IDOL', artist: 'yoasobi', duration: 213 }))
      .toEqual({ lyrics: LRC, wordLyrics: YRC, wordLyricsFormat: 'yrc' });
    expect(fetcher).toHaveBeenCalledWith(`${OFFICIAL}/ncm-lyrics/111.yrc`, expect.anything());
  });

  it('returns line lyrics alone when no word-by-word file exists', async () => {
    const db = new AmllLyricsDb({ directory, fetcher: serving({ [INDEX]: INDEX_TEXT, 'qq-lyrics/003abc.lrc': LRC }) });
    expect(await db.match({ title: 'Lagtrain', artist: '稲葉曇' })).toEqual({ lyrics: LRC });
  });

  it('finds nothing for another artist, an unknown artist or a song it does not list', async () => {
    const fetcher = serving({ [INDEX]: INDEX_TEXT, 'ncm-lyrics/111.yrc': YRC, 'ncm-lyrics/111.lrc': LRC });
    const db = new AmllLyricsDb({ directory, fetcher });

    expect(await db.match({ title: 'Idol', artist: 'Someone Else' })).toBeNull();
    expect(await db.match({ title: 'Idol', artist: 'Unknown Artist' })).toBeNull();
    expect(await db.match({ title: 'Idol (Live)', artist: 'YOASOBI' })).toBeNull();
    expect(await db.match({ title: 'Missing', artist: 'YOASOBI' })).toBeNull();
    // Only the index was downloaded: no lyric file is requested without a match.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps the index on disk for the next launch', async () => {
    await new AmllLyricsDb({ directory, fetcher: serving({ [INDEX]: INDEX_TEXT }) }).match({ title: 'Missing', artist: 'A' });

    const offline = serving({ 'ncm-lyrics/111.yrc': YRC });
    const relaunched = new AmllLyricsDb({ directory, fetcher: offline });
    expect(await relaunched.match({ title: 'Idol', artist: 'YOASOBI' })).toMatchObject({ wordLyrics: YRC });
    expect(offline).not.toHaveBeenCalledWith(`${OFFICIAL}/${INDEX}`, expect.anything());
  });

  it('refreshes a stale index in the background while still answering from it', async () => {
    await new AmllLyricsDb({ directory, fetcher: serving({ [INDEX]: INDEX_TEXT }) }).match({ title: 'Missing', artist: 'A' });

    const newer = `${INDEX_TEXT}\n${line({ musicName: ['Fresh'], artists: ['A'], ncmMusicId: ['333'] })}`;
    const fetcher = serving({ [INDEX]: newer, 'ncm-lyrics/333.lrc': LRC });
    const later = new AmllLyricsDb({ directory, fetcher, now: () => Date.now() + 4 * 24 * 60 * 60 * 1000 });
    expect(await later.match({ title: 'Fresh', artist: 'A' })).toBeNull();
    await vi.waitFor(async () => expect(await later.match({ title: 'Fresh', artist: 'A' })).toEqual({ lyrics: LRC }));
  });

  it('asks the repository alone and fails, rather than finding nothing, when a lyric file cannot be fetched', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === `${OFFICIAL}/${INDEX}`) return new Response(INDEX_TEXT);
      throw new Error('network unreachable');
    });
    const db = new AmllLyricsDb({ directory, fetcher });
    await expect(db.match({ title: 'Idol', artist: 'YOASOBI' })).rejects.toThrow('network unreachable');
    expect(fetcher.mock.calls.every(([url]) => url.startsWith(`${OFFICIAL}/`))).toBe(true);
  });

  it('fails while the index is unreachable and waits before asking for it again', async () => {
    let now = 1_000_000;
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    const db = new AmllLyricsDb({ directory, fetcher, now: () => now });

    await expect(db.match({ title: 'Idol', artist: 'YOASOBI' })).rejects.toThrow('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(db.match({ title: 'Idol', artist: 'YOASOBI' })).rejects.toThrow('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);

    now += 11 * 60 * 1000;
    await expect(db.match({ title: 'Idol', artist: 'YOASOBI' })).rejects.toThrow('unavailable');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
