import { describe, expect, it } from 'vitest';
import { buildWebDAVUrl, webDAVHrefToPath } from '../../services/webdavPath';

describe('webdavPath', () => {
  it('encodes input paths by segment', () => {
    expect(buildWebDAVUrl('https://host/webdav', '/music/a #1?.flac')).toBe(
      'https://host/webdav/music/a%20%231%3F.flac'
    );
  });

  it('does not duplicate the base path when input paths already include it', () => {
    expect(buildWebDAVUrl('https://host/webdav', '/webdav/music/a.flac')).toBe(
      'https://host/webdav/music/a.flac'
    );
  });

  it('converts relative PROPFIND hrefs into app paths', () => {
    expect(webDAVHrefToPath('/webdav/music/a%20%231.flac', 'https://host/webdav')).toBe(
      '/music/a #1.flac'
    );
  });

  it('converts absolute PROPFIND hrefs into app paths', () => {
    expect(webDAVHrefToPath('https://host/webdav/music/a.flac', 'https://host/webdav')).toBe(
      '/music/a.flac'
    );
  });
});
