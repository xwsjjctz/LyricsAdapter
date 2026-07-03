import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  assignChunkId,
  DEFAULT_CHUNK_SIZE,
  Chunk,
  filterManifestEntries,
  Manifest,
  ManifestEntry,
  manifestEntriesEqual,
  metadataFolderService,
} from '../../../services/webdav/metadataFolderService';

const webdavMocks = vi.hoisted(() => ({
  fetchTextFile: vi.fn(),
  uploadTextFile: vi.fn(),
  ensureCollection: vi.fn(),
}));

vi.mock('../../../services/webdavClient', () => ({
  webdavClient: {
    fetchTextFile: webdavMocks.fetchTextFile,
    uploadTextFile: webdavMocks.uploadTextFile,
    ensureCollection: webdavMocks.ensureCollection,
  },
}));

vi.mock('../../../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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

const makeManifest = (entries: Record<string, ManifestEntry> = {}): Manifest => ({
  version: 3,
  generatedAt: '2025-01-01T00:00:00.000Z',
  chunkSize: DEFAULT_CHUNK_SIZE,
  entries,
});

beforeEach(() => {
  webdavMocks.fetchTextFile.mockReset();
  webdavMocks.uploadTextFile.mockReset();
  webdavMocks.ensureCollection.mockReset();
  webdavMocks.ensureCollection.mockResolvedValue(true);
  metadataFolderService.clearCache();
});

describe('assignChunkId', () => {
  it('should assign a chunk id for a new path in an empty manifest', () => {
    const manifest: Manifest = {
      version: 3,
      generatedAt: '2025-01-01T00:00:00.000Z',
      chunkSize: DEFAULT_CHUNK_SIZE,
      entries: {},
    };
    const chunkId = assignChunkId('/music/song.flac', manifest, DEFAULT_CHUNK_SIZE);
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

    const chunkId = assignChunkId('/music/song.flac', manifest, DEFAULT_CHUNK_SIZE);
    expect(chunkId).toBe('0001');
  });
});

describe('metadataFolderService writes', () => {
  it('does not cache a manifest when the remote upload fails', async () => {
    const failedManifest = makeManifest({
      '/music/failed.flac': makeEntry({ title: 'Failed', chunkId: '0001' }),
    });
    const remoteManifest = makeManifest({
      '/music/remote.flac': makeEntry({ title: 'Remote', chunkId: '0001' }),
    });

    webdavMocks.uploadTextFile
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false });

    await expect(metadataFolderService.saveManifest(failedManifest)).resolves.toBe(false);

    webdavMocks.fetchTextFile.mockResolvedValueOnce(JSON.stringify(remoteManifest));
    const loadedManifest = await metadataFolderService.loadManifest(false);

    expect(loadedManifest).toEqual(remoteManifest);
    expect(webdavMocks.fetchTextFile).toHaveBeenCalledWith('/Metadata/_manifest.json');
  });

  it('does not cache a chunk when the remote upload fails', async () => {
    const failedChunk: Chunk = {
      chunkId: '0001',
      entries: {
        '/music/failed.flac': { lyrics: 'failed' },
      },
    };
    const remoteChunk: Chunk = {
      chunkId: '0001',
      entries: {
        '/music/remote.flac': { lyrics: 'remote' },
      },
    };

    webdavMocks.uploadTextFile
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false });

    await expect(metadataFolderService.saveChunk('0001', failedChunk)).resolves.toBe(false);

    webdavMocks.fetchTextFile.mockResolvedValueOnce(JSON.stringify(remoteChunk));
    const loadedChunk = await metadataFolderService.loadChunk('0001');

    expect(loadedChunk).toEqual(remoteChunk);
    expect(webdavMocks.fetchTextFile).toHaveBeenCalledWith('/Metadata/_chunk_0001.json');
  });

  it('does not upload the manifest when a chunk upload fails', async () => {
    const chunk: Chunk = {
      chunkId: '0001',
      entries: {
        '/music/song.flac': { lyrics: 'lyrics' },
      },
    };
    const manifest = makeManifest({
      '/music/song.flac': makeEntry({ chunkId: '0001', hasLyrics: true }),
    });

    webdavMocks.uploadTextFile
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false });

    await expect(
      metadataFolderService.saveChunksAndManifest(new Map([['0001', chunk]]), manifest)
    ).resolves.toBe(false);

    expect(webdavMocks.uploadTextFile).toHaveBeenCalledTimes(2);
    expect(webdavMocks.uploadTextFile).toHaveBeenCalledWith(
      '/Metadata/_chunk_0001.json',
      JSON.stringify(chunk)
    );
  });
});

describe('manifest entry helpers', () => {
  it('detects pruned entries when filtering manifest paths', () => {
    const manifest = makeManifest({
      '/music/keep.flac': makeEntry({ title: 'Keep', chunkId: '0001' }),
      '/music/delete.flac': makeEntry({ title: 'Delete', chunkId: '0001' }),
    });

    const result = filterManifestEntries(manifest, new Set(['/music/keep.flac']));

    expect(result.changed).toBe(true);
    expect(Object.keys(result.entries)).toEqual(['/music/keep.flac']);
  });

  it('does not report changes when all manifest paths are still present', () => {
    const manifest = makeManifest({
      '/music/keep.flac': makeEntry({ title: 'Keep', chunkId: '0001' }),
    });

    const result = filterManifestEntries(manifest, new Set(['/music/keep.flac']));

    expect(result.changed).toBe(false);
    expect(result.entries).toEqual(manifest.entries);
  });

  it('compares manifest entries field by field', () => {
    const entry = makeEntry({ title: 'Before', chunkId: '0001' });

    expect(manifestEntriesEqual(entry, { ...entry })).toBe(true);
    expect(manifestEntriesEqual(entry, { ...entry, title: 'After' })).toBe(false);
    expect(manifestEntriesEqual(undefined, entry)).toBe(false);
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
