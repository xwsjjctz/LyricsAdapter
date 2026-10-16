import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chunk, Manifest } from '@/services/webdav/metadataFolderService';

const mocks = vi.hoisted(() => ({
  cache: new Map<string, Record<string, unknown>>(),
  manifest: null as Manifest | null,
  chunks: new Map<string, Chunk>(),
  saved: [] as { chunks: Map<string, Chunk>; manifest: Manifest }[],
  saveOk: true,
}));

vi.mock('@/services/webdav/metadataCache', () => ({ loadMetadataCache: async () => new Map(mocks.cache) }));
vi.mock('@/services/webdav/coverStore', () => ({
  materializePortableCover: async (url?: string) => (url?.startsWith('data:') ? url : undefined),
}));
vi.mock('@/services/webdav/metadataFolderService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/webdav/metadataFolderService')>();
  return {
    ...actual,
    metadataFolderService: {
      loadManifest: async () => mocks.manifest,
      loadChunk: async (id: string) => mocks.chunks.get(id) ?? null,
      saveChunksAndManifest: async (chunks: Map<string, Chunk>, manifest: Manifest) => {
        mocks.saved.push({ chunks, manifest });
        return mocks.saveOk;
      },
    },
  };
});

import { createManifestSync } from '@/services/webdav/manifestSync';

const provider = { allowWrite: () => true, useMetadataFolder: () => true } as never;
const meta = (extra: Record<string, unknown> = {}) => ({
  title: 'T', artist: 'A', album: 'L', duration: 3, fileSize: 10, lastModified: 'd', ...extra,
});

beforeEach(() => {
  mocks.cache.clear(); mocks.chunks.clear(); mocks.saved.length = 0; mocks.manifest = null; mocks.saveOk = true;
});

describe('WebDAV manifest sync', () => {
  it('writes only portable covers and keeps an existing chunk cover when none is available', async () => {
    mocks.cache.set('/a.flac', meta({ coverUrl: 'data:image/png;base64,AAA' }));
    mocks.cache.set('/b.flac', meta({ coverUrl: 'cover://local-missing', lyrics: 'L' }));
    const readCover = vi.fn(async () => undefined);
    const sync = createManifestSync({ getProvider: () => provider, readCover });

    await sync.upload(new Set(['/a.flac', '/b.flac']));

    const { chunks, manifest } = mocks.saved[0]!;
    const entries = Object.assign({}, ...[...chunks.values()].map(chunk => chunk.entries));
    expect(entries['/a.flac']).toEqual({ coverUrl: 'data:image/png;base64,AAA' });
    // A missing local cover is re-read from the audio; failing that, no cover:// pointer is written.
    expect(readCover).toHaveBeenCalledWith(expect.objectContaining({ path: '/b.flac' }));
    expect(entries['/b.flac']).toEqual({ lyrics: 'L' });
    expect(manifest.entries['/a.flac']?.hasCover).toBe(true);
    expect(manifest.entries['/b.flac']?.hasCover).toBe(false);
  });

  it('drops removed files and keeps the server hasCover flag while local covers are pending', async () => {
    mocks.manifest = {
      version: 3, generatedAt: '', chunkSize: 50,
      entries: {
        '/keep.flac': { ...meta(), fileName: 'keep.flac', chunkId: 'c0', hasCover: true, hasLyrics: false, hasSyncedLyrics: false },
        '/gone.flac': { ...meta(), fileName: 'gone.flac', chunkId: 'c0', hasCover: true, hasLyrics: false, hasSyncedLyrics: false },
      },
    };
    mocks.cache.set('/keep.flac', meta());
    const sync = createManifestSync({ getProvider: () => provider, readCover: async () => undefined });

    await sync.upload(new Set(['/keep.flac']));

    const { manifest } = mocks.saved[0]!;
    expect(Object.keys(manifest.entries)).toEqual(['/keep.flac']);
    expect(manifest.entries['/keep.flac']?.hasCover).toBe(true);
  });

  it('skips read-only providers and rejects a failed server write without blocking the next upload', async () => {
    const readOnly = createManifestSync({ getProvider: () => ({ allowWrite: () => false, useMetadataFolder: () => true }) as never, readCover: async () => undefined });
    await readOnly.upload(new Set());
    expect(mocks.saved).toHaveLength(0);

    mocks.cache.set('/a.flac', meta());
    mocks.saveOk = false;
    const sync = createManifestSync({ getProvider: () => provider, readCover: async () => undefined });
    await expect(sync.upload(new Set(['/a.flac']))).rejects.toThrow('Failed to upload');
    mocks.saveOk = true;
    await expect(sync.upload(new Set(['/a.flac']))).resolves.toBeUndefined();
  });
});
