import { describe, expect, it } from 'vitest';
import type { Track } from '../../types';
import {
  getDesktopImportKey,
  getTrackImportKeys,
  getUniqueWebDAVFileName,
  getWebFileImportKey,
} from '../../services/importIdentity';

describe('importIdentity', () => {
  it('uses full desktop file paths instead of basenames', () => {
    expect(getDesktopImportKey('/Music/A/song.flac')).not.toBe(getDesktopImportKey('/Music/B/song.flac'));
  });

  it('creates stable keys for browser File imports', () => {
    const file = new File(['audio'], 'song.flac', { lastModified: 1234 });

    expect(getWebFileImportKey(file)).toBe('file:song.flac:5:1234');
  });

  it('keeps compatibility keys for existing tracks', () => {
    const track = {
      id: 'track-1',
      fileName: 'song.flac',
      filePath: '/Music/song.flac',
      fileSize: 123,
      lastModified: 456,
    } as Track;

    expect(getTrackImportKeys(track)).toEqual([
      'path:/Music/song.flac',
      'file:song.flac:123:456',
      'name:song.flac',
    ]);
  });

  it('assigns unique WebDAV names without overwriting existing files', () => {
    const existingNames = new Set(['song.flac', 'song (1).flac']);

    expect(getUniqueWebDAVFileName('song.flac', existingNames)).toBe('song (2).flac');
  });

  it('assigns unique names for files without extensions', () => {
    expect(getUniqueWebDAVFileName('README', new Set(['README']))).toBe('README (1)');
  });
});
