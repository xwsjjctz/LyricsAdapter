import { describe, it, expect } from 'vitest';
import {
  assignChunkId,
  DEFAULT_CHUNK_SIZE,
  Manifest,
  ManifestEntry,
} from '../../../services/webdav/metadataFolderService';

const makeEntry = (overrides: Partial<ManifestEntry> = {}): ManifestEntry => ({
  title: 'Test',
  artist: 'Artist',
  album: 'Album',
  duration: 200,
  fileSize: 5000,
  fileName: 'test.flac',
  lastModified: '2025-01-01T00:00:00Z',
  chunkId: '',
  hasCover: false,
  hasLyrics: false,
  hasSyncedLyrics: false,
  ...overrides,
});

describe('assignChunkId', () => {
  it('should assign a chunk id for a new path in an empty manifest', () => {
    const manifest: Manifest = {
      version: 3,
      generatedAt: '2025-01-01T00:00:00.000Z',
      chunkSize: DEFAULT_CHUNK_SIZE,
      entries: {},
    };
    const chunkId = assignChunkId('/music/song.flac', manifest);
    expect(chunkId).toBe('0001');
  });

  it('should reuse non-full chunks for new entries', () => {
    const entry = makeEntry({ chunkId: 'existing' });
    // Create a manifest with an existing chunk that has 30 entries (not full)
    const existingChunkId = '0001';
    const entries: Record<string, ManifestEntry> = {};
    for (let i = 0; i < 30; i++) {
      entries[`/music/song${i}.flac`] = makeEntry({ chunkId: existingChunkId });
    }
    const manifest: Manifest = {
      version: 3,
      generatedAt: '2025-01-01T00:00:00.000Z',
      chunkSize: DEFAULT_CHUNK_SIZE,
      entries,
    };

    const chunkId = assignChunkId('/music/new-song.flac', manifest, DEFAULT_CHUNK_SIZE);
    expect(chunkId).toBe(existingChunkId);
  });

  it('should create a new chunk when existing chunks are full', () => {
    const existingChunkId = '0001';
    const entries: Record<string, ManifestEntry> = {};
    // Fill chunk to capacity (50 entries for default chunk size)
    for (let i = 0; i < DEFAULT_CHUNK_SIZE; i++) {
      entries[`/music/song${i}.flac`] = makeEntry({ chunkId: existingChunkId });
    }
    const manifest: Manifest = {
      version: 3,
      generatedAt: '2025-01-01T00:00:00.000Z',
      chunkSize: DEFAULT_CHUNK_SIZE,
      entries,
    };

    const chunkId = assignChunkId('/music/new-song.flac', manifest, DEFAULT_CHUNK_SIZE);
    expect(chunkId).toBe('0002');
  });

  it('should reuse chunk id if path already has one in manifest', () => {
    const entries: Record<string, ManifestEntry> = {
      '/music/song.flac': makeEntry({ chunkId: '0001' }),
    };
    const manifest: Manifest = {
      version: 3,
      generatedAt: '2025-01-01T00:00:00.000Z',
      chunkSize: DEFAULT_CHUNK_SIZE,
      entries,
    };

    const chunkId = assignChunkId('/music/song.flac', manifest);
    expect(chunkId).toBe('0001');
  });
});

describe('Manifest types', () => {
  it('should create a valid ManifestEntry', () => {
    const entry = makeEntry({
      title: 'Test Song',
      artist: 'Test Artist',
      duration: 180,
    });
    expect(entry.title).toBe('Test Song');
    expect(entry.artist).toBe('Test Artist');
    expect(entry.duration).toBe(180);
    expect(entry.hasCover).toBe(false);
  });

  it('should create a valid Manifest object', () => {
    const entry = makeEntry();
    const manifest: Manifest = {
      version: 3,
      generatedAt: '2025-01-01T00:00:00.000Z',
      chunkSize: DEFAULT_CHUNK_SIZE,
      entries: {
        '/music/test.flac': entry,
      },
    };
    expect(manifest.version).toBe(3);
    expect(Object.keys(manifest.entries).length).toBe(1);
    expect(manifest.entries['/music/test.flac']!.title).toBe('Test');
  });
});
