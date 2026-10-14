// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../electron/services/settingsStore', () => ({ settingsStore: { get: vi.fn() } }));

import { basicAuthorization, webdavAuthorization } from '../../../electron/services/webdavCredentials';

const account = JSON.stringify({ serverUrl: 'https://dav.example.com/dav', username: 'me', password: 'p:w' });
const read = (value: string | undefined) => () => value;

describe('WebDAV credentials in the main process', () => {
  it('attaches the stored account to the configured server only', () => {
    expect(webdavAuthorization('https://dav.example.com/dav/song.flac', 'stored', read(account)))
      .toBe(basicAuthorization({ username: 'me', password: 'p:w' }));
    expect(basicAuthorization({ username: 'me', password: 'p:w' })).toBe(`Basic ${Buffer.from('me:p:w').toString('base64')}`);
    expect(() => webdavAuthorization('https://evil.example.net/dav', 'stored', read(account))).toThrow('configured server');
    expect(() => webdavAuthorization('http://dav.example.com/dav', 'stored', read(account))).toThrow('configured server');
  });

  it('sends nothing for credential-free requests and fails when unconfigured', () => {
    expect(webdavAuthorization('https://cdn.example.org/file', 'none', read(undefined))).toBe('');
    expect(() => webdavAuthorization('https://dav.example.com/dav', 'stored', read(undefined))).toThrow('not configured');
    expect(() => webdavAuthorization('https://dav.example.com/dav', 'stored', read('{"serverUrl":""}'))).toThrow('not configured');
  });
});
