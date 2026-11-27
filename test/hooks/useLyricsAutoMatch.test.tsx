import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Track } from '@/types';

const env = vi.hoisted(() => ({
  lookupAllowed: true,
  hasDesktop: true,
  autoMatch: true,
  tried: new Set<string>(),
  cachedLyrics: new Map<string, string>(),
}));

vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => (env.hasDesktop ? { lyricsLookupAllowed: async () => env.lookupAllowed } : null),
}));
vi.mock('@/services/storage/settingsManager', () => ({ settingsManager: { getLyricsAutoMatch: () => env.autoMatch } }));
vi.mock('@/services/storage/lyricsMatchAttempts', () => ({
  wasLyricsMatchTried: (id: string) => env.tried.has(id),
  rememberLyricsMatchTried: vi.fn((id: string) => { env.tried.add(id); }),
}));
vi.mock('@/services/storage/metadataCacheService', () => ({
  metadataCacheService: { get: (id: string) => (env.cachedLyrics.has(id) ? { lyrics: env.cachedLyrics.get(id) } : undefined) },
}));
vi.mock('@/services/lyrics/lyricsAutoMatch', () => ({
  needsLyricsMatch: (track: Track) => Boolean(track.filePath) && !track.lyrics && !track.syncedLyrics?.length,
  lyricsQueryFor: (track: Track) => ({ title: track.title, artist: track.artist }),
  currentLyricsSources: vi.fn(async () => ({ providers: [] })),
  findLyrics: vi.fn(),
}));

import { useLyricsAutoMatch } from '@/hooks/useLyricsAutoMatch';
import { findLyrics } from '@/services/lyrics/lyricsAutoMatch';
import { rememberLyricsMatchTried } from '@/services/storage/lyricsMatchAttempts';

const LYRICS = { lyrics: '[00:01.00]line' };
const FOUND = { lyrics: LYRICS, conclusive: true };
const NOTHING = { lyrics: null, conclusive: true };

const track = (id: string, lyrics?: string): Track =>
  ({ id, title: id, artist: 'A', album: 'B', duration: 100, audioUrl: '', filePath: `/music/${id}.mp3`, ...(lyrics ? { lyrics } : {}) });

/** Lets pending promises settle and moves the clock, inside act so state updates apply. */
const pass = (milliseconds = 0) => act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });

async function setup(initial: Track[], currentTrackId?: string) {
  const library = { tracks: initial };
  const applyMatchedLyrics = vi.fn(() => true);
  const view = renderHook(
    (props: { tracks: Track[]; currentTrackId: string | undefined }) => useLyricsAutoMatch({
      ready: true,
      localTracks: props.tracks,
      getLocalTracks: () => library.tracks,
      currentTrackId: props.currentTrackId,
      applyMatchedLyrics,
    }),
    { initialProps: { tracks: initial, currentTrackId } },
  );
  // The main process answers whether lookups are allowed; the loaded library then becomes the baseline.
  await pass();
  const update = (tracks: Track[], playing?: string) => {
    library.tracks = tracks;
    view.rerender({ tracks, currentTrackId: playing });
  };
  return { applyMatchedLyrics, update };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(env, { lookupAllowed: true, hasDesktop: true, autoMatch: true });
  env.tried.clear();
  env.cachedLyrics.clear();
  vi.mocked(findLyrics).mockReset().mockResolvedValue(FOUND);
  vi.mocked(rememberLyricsMatchTried).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('useLyricsAutoMatch', () => {
  it('looks up tracks as they are added, not the ones already in the library', async () => {
    const { applyMatchedLyrics, update } = await setup([track('old')]);
    expect(findLyrics).not.toHaveBeenCalled();

    update([track('old'), track('new'), track('tagged', 'has lyrics')]);
    await pass();

    expect(findLyrics).toHaveBeenCalledTimes(1);
    expect(vi.mocked(findLyrics).mock.calls[0]![0]).toEqual({ title: 'new', artist: 'A' });
    expect(applyMatchedLyrics).toHaveBeenCalledWith('new', LYRICS);
    expect(rememberLyricsMatchTried).toHaveBeenCalledWith('new');
  });

  it('takes one track at a time with a pause in between', async () => {
    const { update } = await setup([]);
    update([track('a'), track('b')]);
    await pass();
    expect(findLyrics).toHaveBeenCalledTimes(1);
    await pass(1199);
    expect(findLyrics).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(findLyrics).toHaveBeenCalledTimes(2);
  });

  it('looks up an older track a moment after it starts playing, unless its lyrics are only waiting in the cache', async () => {
    const { applyMatchedLyrics, update } = await setup([track('old'), track('cached')], 'old');
    await pass(2999);
    expect(findLyrics).not.toHaveBeenCalled();
    await pass(1);
    expect(applyMatchedLyrics).toHaveBeenCalledWith('old', LYRICS);

    env.cachedLyrics.set('cached', 'from the cache');
    update([track('old'), track('cached')], 'cached');
    await pass(5000);
    expect(findLyrics).toHaveBeenCalledTimes(1);
  });

  it('remembers a search that found nothing but not one that could not be completed', async () => {
    vi.mocked(findLyrics).mockResolvedValueOnce(NOTHING).mockResolvedValueOnce({ lyrics: null, conclusive: false });
    const { applyMatchedLyrics, update } = await setup([]);
    update([track('searched'), track('offline')]);
    await pass(1200);

    expect(applyMatchedLyrics).not.toHaveBeenCalled();
    expect(vi.mocked(rememberLyricsMatchTried).mock.calls).toEqual([['searched']]);

    // Neither is asked again this session, even when played.
    update([track('searched'), track('offline')], 'offline');
    await pass(5000);
    expect(findLyrics).toHaveBeenCalledTimes(2);
  });

  it('skips a track that was already looked up in an earlier session', async () => {
    env.tried.add('known');
    const { update } = await setup([]);
    update([track('known')]);
    await pass();
    expect(findLyrics).not.toHaveBeenCalled();
  });

  it('survives a failing lookup and carries on with the next track', async () => {
    vi.mocked(findLyrics).mockRejectedValueOnce(new Error('boom'));
    const { applyMatchedLyrics, update } = await setup([]);
    update([track('a'), track('b')]);
    await pass(1200);
    expect(applyMatchedLyrics.mock.calls).toEqual([['b', LYRICS]]);
  });

  it.each([
    ['end-to-end runs, where the main process forbids it', { lookupAllowed: false }],
    ['browser mode, which has no desktop bridge', { hasDesktop: false }],
    ['being switched off in the command palette', { autoMatch: false }],
  ])('does nothing in %s', async (_reason, change) => {
    Object.assign(env, change);
    const { update } = await setup([track('old')], 'old');
    update([track('old'), track('new')], 'old');
    await pass(5000);
    expect(findLyrics).not.toHaveBeenCalled();
  });
});
