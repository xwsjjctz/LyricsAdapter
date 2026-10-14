import { describe, expect, it } from 'vitest';
import {
  buildFileListSnapshot,
  diffFileLists,
  enrichFromChunk,
  enrichTrack,
  fallbackToFilename,
  fileToPlaceholderTrack,
  isCacheValid,
  metaToWebDAVFile,
  parseArtistTitleFromFilename,
  trackToWebDAVFile,
} from '@/services/webdav/trackMapping';
import type { WebDAVFile } from '@/services/webdavClient';

const file = (path: string, size = 10, lastModified = 'Mon, 01 Jan 2024 00:00:00 GMT'): WebDAVFile => ({
  name: path.split('/').pop()!, path, size, lastModified, isDirectory: false,
});

describe('WebDAV track mapping', () => {
  it('diffs a listing against the stored snapshot', () => {
    const snapshot = new Map([
      ['/same.flac', { size: 10, lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT' }],
      ['/changed.flac', { size: 9, lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT' }],
      ['/gone.flac', { size: 1, lastModified: 'x' }],
    ]);
    const diff = diffFileLists([file('/same.flac'), file('/changed.flac'), file('/new.flac')], snapshot);
    expect(diff.unchanged).toEqual(['/same.flac']);
    expect(diff.changed.map(f => f.path)).toEqual(['/changed.flac']);
    expect(diff.added.map(f => f.path)).toEqual(['/new.flac']);
    expect(diff.removed).toEqual(['/gone.flac']);
    expect(buildFileListSnapshot([file('/a.flac', 3, 'd')])).toEqual({ '/a.flac': { size: 3, lastModified: 'd' } });
  });

  it('derives artist and title from file names', () => {
    expect(parseArtistTitleFromFilename('Artist - Song.flac')).toEqual({ artist: 'Artist', title: 'Song' });
    expect(parseArtistTitleFromFilename('Artist_Song.mp3')).toEqual({ artist: 'Artist', title: 'Song' });
    expect(parseArtistTitleFromFilename('Song.mp3')).toEqual({ artist: 'Unknown Artist', title: 'Song' });
    expect(fallbackToFilename(file('/A - B.flac'))).toMatchObject({ artist: 'A', title: 'B', duration: 0, album: 'Unknown Album' });
  });

  it('builds placeholder tracks keyed by path and sorted by upload time', () => {
    const track = fileToPlaceholderTrack(file('/A - B.flac', 42));
    expect(track).toMatchObject({ id: 'webdav-/A - B.flac', source: 'webdav', webdavPath: '/A - B.flac', fileSize: 42, lastModified: Date.parse('Mon, 01 Jan 2024 00:00:00 GMT') });
    expect(fileToPlaceholderTrack(file('/x.flac', 1, 'not a date')).lastModified).toBe(0);
    expect(trackToWebDAVFile(track)).toMatchObject({ path: '/A - B.flac', size: 42, lastModified: '2024-01-01T00:00:00.000Z' });
    expect(metaToWebDAVFile('/dir/x.flac', { fileSize: 5, lastModified: 'd' })).toMatchObject({ name: 'x.flac', size: 5 });
  });

  it('enriches tracks from cached metadata and chunk details without dropping existing values', () => {
    const base = { ...fileToPlaceholderTrack(file('/x.flac')), coverUrl: 'cover://old' };
    const meta = { title: 'T', artist: 'A', album: 'L', duration: 3, fileSize: 10, lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT' };
    expect(enrichTrack(base, meta)).toMatchObject({ title: 'T', duration: 3, coverUrl: 'cover://old' });
    expect(isCacheValid(meta, file('/x.flac'))).toBe(true);
    expect(isCacheValid(meta, file('/x.flac', 11))).toBe(false);
    expect(enrichFromChunk({ ...base, lyrics: 'keep' }, { coverUrl: 'data:new' })).toMatchObject({ coverUrl: 'data:new', lyrics: 'keep' });
  });
});
