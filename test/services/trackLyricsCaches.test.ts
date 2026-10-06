import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';

const { metadataCache } = vi.hoisted(() => ({
  metadataCache: { initialize: vi.fn(async () => {}), set: vi.fn() },
}));

vi.mock('@/services/metadataCacheService', () => ({ metadataCacheService: metadataCache }));

import { refreshTrackLyricsCaches } from '@/services/trackLyricsCaches';

const wordLine = { time: 1, text: '你好', words: [{ time: 1, duration: 0.5, text: '你好' }] };
const base: Track = { id: 't1', title: 'T', artist: 'A', album: 'B', duration: 90, audioUrl: '' };

describe('refreshTrackLyricsCaches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rewrites the local metadata cache with the edited word lyrics', async () => {
    await refreshTrackLyricsCaches({
      ...base, filePath: '/music/t1.flac', fileName: 't1.flac', fileSize: 10, lastModified: 5,
      lyrics: '你好', syncedLyrics: [wordLine], wordLyrics: '[1000,500](1000,500,0)你好', wordLyricsFormat: 'yrc',
    });

    expect(metadataCache.initialize).toHaveBeenCalled();
    expect(metadataCache.set).toHaveBeenCalledWith('t1', {
      title: 'T', artist: 'A', album: 'B', duration: 90, lyrics: '你好', syncedLyrics: [wordLine],
      wordLyrics: '[1000,500](1000,500,0)你好', wordLyricsFormat: 'yrc',
      fileName: 't1.flac', fileSize: 10, lastModified: 5,
    });
  });

  it('leaves tracks without a local file untouched', async () => {
    await refreshTrackLyricsCaches({ ...base, source: 'qq', songmid: 'mid', lyrics: '你好' });
    expect(metadataCache.initialize).not.toHaveBeenCalled();
    expect(metadataCache.set).not.toHaveBeenCalled();
  });
});
