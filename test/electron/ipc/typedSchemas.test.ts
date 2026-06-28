import { describe, expect, it } from 'vitest';
import { typedIpcSchemas } from '../../../electron/ipc/typedSchemas';

describe('typedIpcSchemas', () => {
  it('accepts valid WebDAV range payloads', () => {
    const result = typedIpcSchemas.webdavRange.safeParse({
      url: 'https://example.com/music/song.flac',
      authHeader: 'Basic token',
      start: 0,
      end: 1023,
    });

    expect(result.success).toBe(true);
  });

  it('rejects non-http WebDAV URLs', () => {
    const result = typedIpcSchemas.webdavRange.safeParse({
      url: 'file:///etc/passwd',
      authHeader: '',
      start: 0,
      end: 1023,
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid PROPFIND depth values', () => {
    const result = typedIpcSchemas.webdavPropfind.safeParse({
      url: 'https://example.com/webdav',
      authHeader: 'Basic token',
      depth: 'infinity',
    });

    expect(result.success).toBe(false);
  });
});
