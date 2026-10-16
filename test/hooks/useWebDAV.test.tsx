import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebDAVFile } from '@/services/webdavClient';

const mocks = vi.hoisted(() => ({
  files: [] as WebDAVFile[],
  snapshot: null as Record<string, { size: number; lastModified: string }> | null,
  cache: new Map<string, Record<string, unknown>>(),
  readMetadata: vi.fn(),
  upload: vi.fn(async () => undefined),
  setFileListSnapshot: vi.fn(async () => undefined),
  saveMetadataCache: vi.fn(async () => undefined),
}));

vi.mock('@/services/webdavClient', () => ({
  webdavClient: {
    hasConfig: () => true,
    getConfig: () => ({ serverUrl: 'https://dav.example.com', username: 'u', password: 'p' }),
    listFiles: async () => mocks.files,
    clearCdnCache: vi.fn(),
  },
}));
vi.mock('@/services/indexedDBStorage', () => ({
  indexedDBStorage: {
    getFileListSnapshot: async () => mocks.snapshot,
    setFileListSnapshot: mocks.setFileListSnapshot,
  },
}));
vi.mock('@/services/webdav/providerConfig', () => ({
  getEffectiveConfig: () => ({ batchSize: () => 2, useMetadataFolder: () => false, allowWrite: () => true }),
}));
vi.mock('@/services/webdav/metadataCache', () => ({
  loadMetadataCache: async () => new Map(mocks.cache),
  saveMetadataCache: mocks.saveMetadataCache,
  migrateCachedCover: async (meta: unknown) => meta,
}));
vi.mock('@/services/webdav/metadataReader', () => ({
  createMetadataReader: () => ({ readMetadata: mocks.readMetadata, readCover: vi.fn() }),
}));
vi.mock('@/services/webdav/manifestSync', () => ({ createManifestSync: () => ({ upload: mocks.upload }) }));
vi.mock('@/services/webdav/metadataFolderService', () => ({ metadataFolderService: { loadManifest: async () => null, clearCache: vi.fn() } }));
vi.mock('@/services/webdav/coverStore', () => ({ storeCoverLocally: async (url: string) => url }));

import { useWebDAV } from '@/hooks/useWebDAV';

const file = (name: string, size = 10): WebDAVFile => ({ name, path: `/${name}`, size, lastModified: 'd', isDirectory: false });
const parsed = (title: string) => ({ title, artist: 'A', album: 'L', duration: 5, fileSize: 10, lastModified: 'd' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.clear();
  mocks.snapshot = null;
  mocks.readMetadata.mockImplementation(async (f: WebDAVFile) => parsed(f.name));
});

async function load() {
  const { result } = renderHook(() => useWebDAV());
  let outcome: Awaited<ReturnType<typeof result.current.loadWebDAVFiles>> | undefined;
  await act(async () => { outcome = await result.current.loadWebDAVFiles(); });
  return { result, outcome: outcome! };
}

describe('useWebDAV loading', () => {
  it('parses every file on a cold start and records the listing after the manifest is written', async () => {
    mocks.files = [file('a.flac'), file('b.flac'), file('c.flac')];
    const { outcome, result } = await load();

    expect(outcome.type).toBe('full');
    expect(outcome.type === 'full' && outcome.tracks.map(t => t.title)).toEqual(['a.flac', 'b.flac', 'c.flac']);
    expect(mocks.readMetadata).toHaveBeenCalledTimes(3);
    expect(mocks.upload).toHaveBeenCalledBefore(mocks.setFileListSnapshot);
    expect(mocks.setFileListSnapshot).toHaveBeenCalledWith({ '/a.flac': { size: 10, lastModified: 'd' }, '/b.flac': { size: 10, lastModified: 'd' }, '/c.flac': { size: 10, lastModified: 'd' } });
    expect(result.current.loadProgress).toBeNull();
  });

  it('builds the list from cache without reading headers when listing, snapshot and cache agree', async () => {
    mocks.files = [file('a.flac')];
    mocks.snapshot = { '/a.flac': { size: 10, lastModified: 'd' } };
    mocks.cache.set('/a.flac', parsed('Cached'));
    const { outcome } = await load();

    expect(outcome.type === 'full' && outcome.tracks[0]?.title).toBe('Cached');
    expect(mocks.readMetadata).not.toHaveBeenCalled();
  });

  it('reads only added files and reports removals as a diff', async () => {
    mocks.files = [file('a.flac'), file('new.flac')];
    mocks.snapshot = { '/a.flac': { size: 10, lastModified: 'd' }, '/gone.flac': { size: 1, lastModified: 'd' } };
    mocks.cache.set('/a.flac', parsed('Cached'));
    const { outcome } = await load();

    expect(outcome).toMatchObject({ type: 'diff', removed: ['webdav-/gone.flac'], updated: [] });
    expect(outcome.type === 'diff' && outcome.added.map(t => t.title)).toEqual(['new.flac']);
    expect(mocks.readMetadata).toHaveBeenCalledTimes(1);
    expect(mocks.saveMetadataCache).toHaveBeenCalled();
  });

  it('keeps the old listing when the manifest upload fails, so the next start re-checks', async () => {
    mocks.files = [file('a.flac')];
    mocks.upload.mockRejectedValueOnce(new Error('offline'));
    const { result } = await load();

    expect(mocks.setFileListSnapshot).not.toHaveBeenCalled();
    expect(result.current.error).toContain('offline');
  });
});
