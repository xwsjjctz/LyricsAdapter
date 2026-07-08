import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Track } from '@/types';

// Mock module-level dependencies to prevent import failures
vi.mock('@/services/webdavClient', () => ({
  webdavClient: {},
}));
vi.mock('@/services/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@/services/metadataCacheService', () => ({
  metadataCacheService: { get: vi.fn(), set: vi.fn() },
}));
vi.mock('@/services/onlineMusicProvider', () => ({
  getOnlineProvider: () => ({ id: 'qq', getLyrics: vi.fn() }),
  OnlineSource: {},
}));
vi.mock('@/services/qqMusicApi', () => ({ qqMusicApi: {} }));
vi.mock('@/services/neteaseMusicApi', () => ({ neteaseMusicApi: {} }));
vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => null,
  getDesktopAPIAsync: () => Promise.resolve(null),
}));
vi.mock('@/services/cookieManager', () => ({
  cookieManager: { ensureLoaded: vi.fn(), getCookie: () => '' },
  neteaseCookieManager: { ensureLoaded: vi.fn(), getCookie: () => '' },
}));

import { usePlayback } from '@/hooks/usePlayback';

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    title: 'Test',
    artist: 'Artist',
    album: 'Album',
    duration: 10,
    audioUrl: '',
    ...overrides,
  };
}

function renderPlayback(initialTracks: Track[], initialIndex = 0) {
  return renderHook(() =>
    usePlayback({
      tracks: initialTracks,
      setTracks: vi.fn(),
      currentTrackIndex: initialIndex,
      setCurrentTrackIndex: vi.fn(),
      revokeBlobUrl: vi.fn(),
      onTrackSwitch: vi.fn(),
      initialCurrentTime: 0,
    })
  );
}

describe('usePlayback', () => {
  describe('loadAudioFileForTrack', () => {
    it('builds audio:// URL for a unix local file path', async () => {
      const { result } = renderPlayback([makeTrack({ id: 't1', filePath: '/music/test.flac', source: 'local' })]);
      const track = makeTrack({ id: 't2', filePath: '/music/song.flac', source: 'local' });
      const updated = await result.current.loadAudioFileForTrack(track);
      expect(updated.audioUrl).toBe('audio://localhost/music/song.flac');
    });

    it('encodes special characters', async () => {
      const { result } = renderPlayback([makeTrack({ id: 't1', filePath: '/music/test.flac', source: 'local' })]);
      const track = makeTrack({ id: 't3', filePath: '/music/file name.flac', source: 'local' });
      const updated = await result.current.loadAudioFileForTrack(track);
      expect(updated.audioUrl).toContain(encodeURIComponent(' '));
    });

    it('normalizes Windows backslashes (colon kept as-is — actual encoding handled by audio protocol)', async () => {
      const { result } = renderPlayback([makeTrack({ id: 't1', filePath: '/music/test.flac', source: 'local' })]);
      const track = makeTrack({ id: 't4', filePath: 'C:\\Music\\song.flac', source: 'local' });
      const updated = await result.current.loadAudioFileForTrack(track);
      expect(updated.audioUrl).toBe('audio://localhost/C:/Music/song.flac');
      expect(updated.audioUrl).not.toContain('\\');
    });
  });
});
