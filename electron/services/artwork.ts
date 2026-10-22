import path from 'node:path';
import { app, nativeImage, net } from 'electron';
import { REMOTE_COVER_CACHE_DIR, RemoteCoverCache } from './remoteCoverCache';

// Artwork for native surfaces (control bar, command palette, playlist switcher,
// FocusMode glass), decoded in the main process because AppKit draws it.

// app: is the renderer bundle (e.g. the default cover), served by our own handler.
const ALLOWED_ARTWORK_PROTOCOLS = new Set(['cover:', 'https:', 'http:', 'data:', 'app:']);
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
// nativeImage decodes only PNG and JPEG. Cover CDNs such as y.gtimg.cn
// negotiate WebP from the renderer's <img> Accept header, and Chromium's HTTP
// cache is not keyed on Accept, so a cached renderer response would hand the
// main process undecodable WebP. Skip the cache and ask for decodable formats.
const ARTWORK_REQUEST: RequestInit = {
  cache: 'no-store',
  headers: { Accept: 'image/png,image/jpeg;q=0.9,*/*;q=0.1' },
};

const REMOTE_ARTWORK_PROTOCOLS = new Set(['https:', 'http:']);

async function fetchArtwork(source: string): Promise<Buffer | null> {
  const response = await net.fetch(source, ARTWORK_REQUEST);
  if (!response.ok) return null;
  const declaredSize = Number(response.headers.get('content-length') ?? 0);
  if (declaredSize > MAX_ARTWORK_BYTES) throw new Error('Artwork is too large');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength > MAX_ARTWORK_BYTES) throw new Error('Artwork is too large');
  return data;
}

let remoteCovers: RemoteCoverCache | null = null;
/** Online covers kept on disk, so surfaces opened after a restart need no network. */
export function remoteCoverCache(): RemoteCoverCache {
  remoteCovers ??= new RemoteCoverCache(path.join(app.getPath('userData'), REMOTE_COVER_CACHE_DIR), async source => {
    const data = await fetchArtwork(source);
    // Only decodable covers are kept; an error page is fetched again next time.
    return data && !nativeImage.createFromBuffer(data).isEmpty() ? data : null;
  });
  return remoteCovers;
}

/** Fetches and decodes an artwork URL into a compact square PNG; null when unavailable. */
export async function loadArtwork(source: string, size = 96): Promise<Buffer | null> {
  const url = new URL(source);
  if (!ALLOWED_ARTWORK_PROTOCOLS.has(url.protocol)) throw new Error('Unsupported artwork protocol');
  // Local covers are already files (cover:// keeps its own thumbnails); online ones are cached here.
  const data = REMOTE_ARTWORK_PROTOCOLS.has(url.protocol) ? await remoteCoverCache().get(source) : await fetchArtwork(source);
  if (!data) return null;
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) return null;
  const resized = image.resize({ width: size, height: size, quality: 'best' });
  return resized.toPNG();
}
