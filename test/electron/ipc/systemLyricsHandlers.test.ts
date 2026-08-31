import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  logger: { error: vi.fn() },
}));

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('@/../electron/logger', () => ({ logger: mocks.logger }));

import { registerSystemLyricsHandlers } from '@/../electron/ipc/systemLyricsHandlers';

describe('systemLyricsHandlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates and forwards a renderer state update', async () => {
    const update = vi.fn();
    registerSystemLyricsHandlers({ update });
    const handler = mocks.handle.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown,
    ) => Promise<unknown>;
    const state = {
      trackId: 'track-1',
      coverUrl: 'cover://track-1.jpg',
      title: 'Title',
      artist: 'Artist',
      line: 'Current line',
      lineCursor: 4,
      nextLine: 'Next line',
      isPlaying: true,
    };

    await expect(handler({}, state)).resolves.toEqual({ ok: true, data: undefined });
    expect(update).toHaveBeenCalledWith(state);
  });

  it('rejects malformed state before it reaches a system surface', async () => {
    const update = vi.fn();
    registerSystemLyricsHandlers({ update });
    const handler = mocks.handle.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown,
    ) => Promise<{ ok: boolean }>;

    await expect(handler({}, { trackId: 'track-1' })).resolves.toMatchObject({ ok: false });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns a typed failure when the platform surface rejects an update', async () => {
    registerSystemLyricsHandlers({
      update: vi.fn().mockRejectedValue(new Error('surface unavailable')),
    });
    const handler = mocks.handle.mock.calls[0]?.[1] as (
      event: unknown,
      payload: unknown,
    ) => Promise<unknown>;

    await expect(handler({}, {
      trackId: null,
      coverUrl: '',
      title: '',
      artist: '',
      line: '',
      lineCursor: null,
      nextLine: '',
      isPlaying: false,
    })).resolves.toEqual({ ok: false, error: 'surface unavailable' });
  });
});
