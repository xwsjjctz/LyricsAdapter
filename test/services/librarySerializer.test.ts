import { describe, it, expect } from 'vitest';
import { buildLibraryIndexData } from '@/services/librarySerializer';
import type { Track } from '@/types';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'test-id',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 200,
    lyrics: '',
    syncedLyrics: undefined,
    audioUrl: '',
    coverUrl: '',
    filePath: '/music/test.flac',
    fileName: 'test.flac',
    fileSize: 5000,
    lastModified: 1_234_567_890,
    addedAt: '2025-01-01T00:00:00.000Z',
    playCount: 0,
    lastPlayed: undefined,
    available: true,
    source: 'local',
    webdavPath: undefined,
    ...overrides,
  };
}

describe('buildLibraryIndexData', () => {
  const settings = { version: 1, activeSlotId: 'local' as const };

  it('should serialize tracks with cover URL preserved', () => {
    const tracks = [makeTrack({ coverUrl: 'https://example.com/cover.jpg' })];
    const result = buildLibraryIndexData(tracks, settings);
    expect(result.songs[0]!.coverUrl).toBe('https://example.com/cover.jpg');
  });

  it('should clear blob: and file: cover URLs', () => {
    const tracks = [
      makeTrack({ coverUrl: 'blob:some-blob-url' }),
      makeTrack({ coverUrl: 'file:///some/path.jpg' }),
    ];
    const result = buildLibraryIndexData(tracks, settings);
    expect(result.songs[0]!.coverUrl).toBe('');
    expect(result.songs[1]!.coverUrl).toBe('');
  });

  it('should keep cover:// URLs', () => {
    const tracks = [makeTrack({ coverUrl: 'cover://track-123' })];
    const result = buildLibraryIndexData(tracks, settings);
    expect(result.songs[0]!.coverUrl).toBe('cover://track-123');
  });

  it('should include cloudTracks when provided', () => {
    const tracks = [makeTrack({ id: 'local-1' })];
    const cloudTracks = [makeTrack({ id: 'cloud-1', source: 'webdav' })];
    const result = buildLibraryIndexData(tracks, settings, cloudTracks);
    expect(result.songs).toHaveLength(1);
    expect(result.songs[0]!.id).toBe('local-1');
    expect(result.cloudSongs).toHaveLength(1);
    expect(result.cloudSongs![0]!.id).toBe('cloud-1');
  });

  it('should omit cloudSongs when cloudTracks is empty', () => {
    const tracks = [makeTrack()];
    const result = buildLibraryIndexData(tracks, settings, []);
    expect(result.cloudSongs).toBeUndefined();
  });

  it('should include settings in output', () => {
    const tracks = [makeTrack()];
    const result = buildLibraryIndexData(tracks, settings);
    expect(result.settings).toEqual(settings);
  });

  it('should serialize all track fields correctly', () => {
    const track = makeTrack({
      syncedLyrics: [{ time: 1.0, text: 'line1' }],
      playCount: 5,
      lastPlayed: '2025-06-01T00:00:00.000Z',
      source: 'local',
    });
    const result = buildLibraryIndexData([track], settings);
    const s = result.songs[0]!;
    expect(s.id).toBe('test-id');
    expect(s.title).toBe('Test Song');
    expect(s.artist).toBe('Test Artist');
    expect(s.duration).toBe(200);
    expect(s.playCount).toBe(5);
    expect(s.lastPlayed).toBe('2025-06-01T00:00:00.000Z');
    expect(s.syncedLyrics).toEqual([{ time: 1.0, text: 'line1' }]);
    expect(s.source).toBe('local');
  });

  it('should handle missing optional fields gracefully', () => {
    const minimal = {
      id: 'minimal',
      title: 'Minimal',
      artist: '',
      album: '',
      duration: 0,
      lyrics: '',
      audioUrl: '',
      source: 'local' as const,
    } as unknown as Track;
    const result = buildLibraryIndexData([minimal], settings);
    const s = result.songs[0]!;
    expect(s.coverUrl).toBe('');
    expect(s.filePath).toBe('');
    expect(s.fileSize).toBe(0);
    expect(s.available).toBe(true);
  });
});
