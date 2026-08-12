// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  atomicSync: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
    readFileSync: mocks.readFileSync,
    copyFileSync: mocks.copyFileSync,
  },
}));
vi.mock('write-file-atomic', () => ({ default: { sync: mocks.atomicSync } }));
vi.mock('../../electron/logger', () => ({ logger: mocks.logger }));

import { readJsonWithBackup, writeJsonAtomic } from '../../electron/utils/atomicWrite';

describe('atomic JSON primary/backup contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockImplementation((filePath: string) => (
      filePath === '/data/settings.json' || filePath === '/data/settings.json.bak' || filePath === '/data'
    ));
  });

  it('repairs a corrupt primary from a valid backup without rotating the backup', () => {
    mocks.readFileSync.mockImplementation((filePath: string) => {
      if (filePath === '/data/settings.json') return '{broken';
      if (filePath === '/data/settings.json.bak') return '{"theme":"dark"}';
      throw new Error('unexpected path');
    });

    expect(readJsonWithBackup('/data/settings.json')).toEqual({
      data: { theme: 'dark' },
      source: 'backup',
    });
    expect(mocks.atomicSync).toHaveBeenCalledWith(
      '/data/settings.json',
      JSON.stringify({ theme: 'dark' }, null, 2),
    );
    expect(mocks.copyFileSync).not.toHaveBeenCalled();
  });

  it('does not overwrite a good backup with an invalid primary before writing', () => {
    mocks.readFileSync.mockReturnValue('{broken');

    writeJsonAtomic('/data/settings.json', { theme: 'light' }, { keepBackup: true });

    expect(mocks.copyFileSync).not.toHaveBeenCalled();
    expect(mocks.atomicSync).toHaveBeenCalledWith(
      '/data/settings.json',
      JSON.stringify({ theme: 'light' }, null, 2),
    );
  });

  it('rotates a valid primary before replacing it', () => {
    mocks.readFileSync.mockReturnValue('{"theme":"dark"}');

    writeJsonAtomic('/data/settings.json', { theme: 'light' }, { keepBackup: true });

    expect(mocks.copyFileSync).toHaveBeenCalledWith(
      '/data/settings.json',
      '/data/settings.json.bak',
    );
  });

  it('treats schema-invalid JSON as corrupt and recovers a semantically valid backup', () => {
    mocks.readFileSync.mockImplementation((filePath: string) => {
      if (filePath === '/data/settings.json') return '{}';
      if (filePath === '/data/settings.json.bak') return '{"theme":"dark"}';
      throw new Error('unexpected path');
    });
    const validate = (value: unknown) => (
      typeof value === 'object'
      && value !== null
      && typeof (value as { theme?: unknown }).theme === 'string'
    );

    expect(readJsonWithBackup('/data/settings.json', { validate })).toEqual({
      data: { theme: 'dark' },
      source: 'backup',
    });
    expect(mocks.atomicSync).toHaveBeenCalledWith(
      '/data/settings.json',
      JSON.stringify({ theme: 'dark' }, null, 2),
    );
  });

  it('does not rotate schema-invalid but syntactically valid JSON', () => {
    mocks.readFileSync.mockReturnValue('{}');
    const validate = (value: unknown) => (
      typeof value === 'object'
      && value !== null
      && typeof (value as { theme?: unknown }).theme === 'string'
    );

    writeJsonAtomic('/data/settings.json', { theme: 'light' }, { keepBackup: true, validate });

    expect(mocks.copyFileSync).not.toHaveBeenCalled();
  });

  it('refuses schema-invalid new data before touching the filesystem', () => {
    const validate = (value: unknown) => (
      typeof value === 'object'
      && value !== null
      && typeof (value as { theme?: unknown }).theme === 'string'
    );

    expect(() => writeJsonAtomic('/data/settings.json', {}, { validate })).toThrow('schema-invalid JSON');
    expect(mocks.copyFileSync).not.toHaveBeenCalled();
    expect(mocks.atomicSync).not.toHaveBeenCalled();
  });
});
