import { describe, expect, it } from 'vitest';
import { persistenceBootstrapSchema, typedIpcSchemas } from '../../../electron/ipc/typedSchemas';

describe('typedIpcSchemas', () => {
  it('bounds system lyrics payloads passed to system surfaces', () => {
    expect(typedIpcSchemas.systemLyricsState.safeParse({
      trackId: 'track-1',
      coverUrl: 'cover://track-1.jpg?v=0123456789abcdef',
      title: 'Title',
      artist: 'Artist',
      line: 'Current line',
      lineCursor: 0,
      nextLine: 'Next line',
      isPlaying: true,
    }).success).toBe(true);
    expect(typedIpcSchemas.systemLyricsState.safeParse({
      trackId: null,
      coverUrl: '',
      title: '',
      artist: '',
      line: 'x'.repeat(4097),
      lineCursor: null,
      nextLine: '',
      isPlaying: false,
    }).success).toBe(false);
  });

  it('accepts nullable bounded lyric cursors and rejects invalid offsets', () => {
    const state = {
      trackId: 'track-1',
      coverUrl: 'cover://track-1.jpg',
      title: 'Title',
      artist: 'Artist',
      line: 'Current line',
      nextLine: 'Next line',
      isPlaying: true,
    };

    expect(typedIpcSchemas.systemLyricsState.safeParse({ ...state, lineCursor: null }).success)
      .toBe(true);
    expect(typedIpcSchemas.systemLyricsState.safeParse({ ...state, lineCursor: 0 }).success)
      .toBe(true);
    expect(typedIpcSchemas.systemLyricsState.safeParse({ ...state, lineCursor: 4095 }).success)
      .toBe(true);
    expect(typedIpcSchemas.systemLyricsState.safeParse({ ...state, lineCursor: -1 }).success)
      .toBe(false);
    expect(typedIpcSchemas.systemLyricsState.safeParse({ ...state, lineCursor: 4096 }).success)
      .toBe(false);
    expect(typedIpcSchemas.systemLyricsState.safeParse({ ...state, lineCursor: 1.5 }).success)
      .toBe(false);
  });

  it('accepts only bounded local-cover and HTTPS artwork URLs', () => {
    const state = {
      trackId: 'track-1',
      title: 'Title',
      artist: 'Artist',
      line: 'Current line',
      lineCursor: 0,
      nextLine: 'Next line',
      isPlaying: true,
    };

    expect(typedIpcSchemas.systemLyricsState.safeParse({
      ...state,
      coverUrl: 'https://example.com/cover.jpg',
    }).success).toBe(true);
    for (const coverUrl of [
      'http://example.com/cover.jpg',
      'file:///C:/music/cover.jpg',
      'blob:app://localhost/id',
      'data:image/png;base64,AA==',
      `https://example.com/${'x'.repeat(8192)}`,
    ]) {
      expect(typedIpcSchemas.systemLyricsState.safeParse({ ...state, coverUrl }).success)
        .toBe(false);
    }
  });

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

  it('validates typed settings payloads', () => {
    expect(typedIpcSchemas.settingsSet.safeParse({ key: 'app-theme', value: 'default-dark' }).success).toBe(true);
    expect(typedIpcSchemas.settingsSet.safeParse({ key: '', value: 'default-dark' }).success).toBe(false);
    expect(typedIpcSchemas.settingsEntries.safeParse({ entries: { valid: 'string', invalid: 3 } }).success).toBe(false);
  });

  it('validates the user-data persistence envelope', () => {
    const valid = typedIpcSchemas.userDataSave.safeParse({
      data: {
        schemaVersion: 1,
        libraryInitialized: true,
        tracks: [{ id: 'track-1', slotId: 'local', filePath: '/music/song.flac' }],
        settings: { 'app-theme': 'default-dark' },
        playback: { _json: '{}' },
      },
    });
    const invalid = typedIpcSchemas.userDataSave.safeParse({
      data: {
        schemaVersion: 1,
        libraryInitialized: true,
        tracks: [{ slotId: 'local' }],
        settings: {},
        playback: {},
      },
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
    expect(typedIpcSchemas.userDataSave.safeParse({ data: {} }).success).toBe(false);
    expect(typedIpcSchemas.userDataSave.safeParse({
      data: {
        schemaVersion: 2,
        libraryInitialized: true,
        tracks: [],
        settings: {},
        playback: {},
      },
    }).success).toBe(false);
  });

  it('validates each persistence bootstrap source independently', () => {
    const valid = persistenceBootstrapSchema.safeParse({
      settings: { status: 'error', error: 'settings unavailable' },
      userData: {
        status: 'ready',
        data: {
          schemaVersion: 1,
          libraryInitialized: true,
          tracks: [],
          settings: {},
          playback: {},
        },
      },
      libraryIndex: { status: 'ready', data: { songs: [], settings: {} } },
    });
    const invalid = persistenceBootstrapSchema.safeParse({
      settings: { status: 'ready', data: { 'app-theme': 42 } },
      userData: { status: 'error', error: 'users unavailable' },
      libraryIndex: { status: 'ready', data: {} },
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
    expect(persistenceBootstrapSchema.safeParse({
      settings: { status: 'ready', data: {} },
      userData: { status: 'error', error: 'users unavailable' },
      libraryIndex: { status: 'ready', data: null },
    }).success).toBe(false);
  });
});
