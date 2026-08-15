import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }));
vi.mock('music-tag-native', () => ({
  MusicFile: { load: vi.fn() },
  MetaPicture: class {},
}));
vi.mock('@applemusic-like-lyrics/lyric', () => ({
  parseLrc: vi.fn(() => []),
  parseQrc: vi.fn(() => []),
  parseYrc: vi.fn(() => []),
}));
vi.mock('../../../electron/services/wordLyricsTagService', () => ({
  readWordLyrics: vi.fn(() => ({})),
  writeWordLyrics: vi.fn(),
}));
vi.mock('../../../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { coverFileNameFromUri } from '../../../electron/services/audioMetadataService';

describe('audio metadata cover URL parsing', () => {
  it('accepts raw and content-versioned flat cover URLs', () => {
    expect(coverFileNameFromUri('cover://track.jpg')).toBe('track.jpg');
    expect(coverFileNameFromUri('cover://track.jpg?v=abc123&size=128')).toBe('track.jpg');
  });

  it('rejects encoded or platform-specific path traversal', () => {
    expect(coverFileNameFromUri('cover://../secret.jpg?v=abc')).toBeNull();
    expect(coverFileNameFromUri('cover://..%2Fsecret.jpg?v=abc')).toBeNull();
    expect(coverFileNameFromUri('cover://..%5Csecret.jpg?v=abc')).toBeNull();
  });
});
