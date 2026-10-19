import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adoptInstalledSafeStorageKey,
  configureDevelopmentProfile,
  DEVELOPMENT_USER_DATA_DIRECTORY,
} from '../../electron/developmentProfile';

const APP_DATA = 'C:\\Users\\tester\\AppData\\Roaming';
const INSTALLED_USER_DATA = path.join(APP_DATA, 'lyrics-adapter');
type LocalState = { os_crypt?: { encrypted_key?: string; audit_enabled?: boolean }; [key: string]: unknown };
const sharedKey = () => vi.fn((_installed: string, _development: string) => true);

function createApp(overrides: {
  isPackaged?: boolean;
  hasExplicitUserDataDirectory?: boolean;
} = {}) {
  const setPath = vi.fn();
  return {
    app: {
      isPackaged: overrides.isPackaged ?? false,
      commandLine: {
        hasSwitch: vi.fn(() => overrides.hasExplicitUserDataDirectory ?? false),
      },
      getPath: vi.fn((name: string) => (name === 'userData' ? INSTALLED_USER_DATA : APP_DATA)),
      setPath,
    },
    setPath,
  };
}

describe('configureDevelopmentProfile', () => {
  it('isolates an unpackaged build before Electron acquires its process lock', () => {
    const { app, setPath } = createApp();
    const ensureDirectory = vi.fn();

    const result = configureDevelopmentProfile(
      app as never,
      ensureDirectory,
      null,
    );

    const expected = path.join(APP_DATA, DEVELOPMENT_USER_DATA_DIRECTORY);
    expect(result).toBe(expected);
    expect(ensureDirectory).toHaveBeenCalledWith(expected);
    expect(setPath).toHaveBeenCalledWith('userData', expected);
  });

  it('shares the installed safeStorage key before switching to the development profile', () => {
    const { app, setPath } = createApp();
    const shareKey = sharedKey();

    configureDevelopmentProfile(app as never, vi.fn(), shareKey);

    const expected = path.join(APP_DATA, DEVELOPMENT_USER_DATA_DIRECTORY);
    expect(shareKey).toHaveBeenCalledWith(INSTALLED_USER_DATA, expected);
    expect(shareKey.mock.invocationCallOrder[0]).toBeLessThan(setPath.mock.invocationCallOrder[0]!);
  });

  it('still starts the development profile when the key cannot be shared', () => {
    const { app, setPath } = createApp();
    const shareKey = vi.fn((_installed: string, _development: string): boolean => { throw new Error('Local State is locked'); });

    const expected = path.join(APP_DATA, DEVELOPMENT_USER_DATA_DIRECTORY);
    expect(configureDevelopmentProfile(app as never, vi.fn(), shareKey)).toBe(expected);
    expect(setPath).toHaveBeenCalledWith('userData', expected);
  });

  it('does not change the packaged application profile', () => {
    const { app, setPath } = createApp({ isPackaged: true });
    const ensureDirectory = vi.fn();
    const shareKey = sharedKey();

    expect(configureDevelopmentProfile(app as never, ensureDirectory, shareKey)).toBeNull();
    expect(ensureDirectory).not.toHaveBeenCalled();
    expect(shareKey).not.toHaveBeenCalled();
    expect(setPath).not.toHaveBeenCalled();
  });

  it('preserves an explicit user-data-dir used by isolated test launches', () => {
    const { app, setPath } = createApp({
      hasExplicitUserDataDirectory: true,
    });
    const ensureDirectory = vi.fn();
    const shareKey = sharedKey();

    expect(configureDevelopmentProfile(app as never, ensureDirectory, shareKey)).toBeNull();
    expect(ensureDirectory).not.toHaveBeenCalled();
    expect(shareKey).not.toHaveBeenCalled();
    expect(setPath).not.toHaveBeenCalled();
  });
});

describe('adoptInstalledSafeStorageKey', () => {
  const roots: string[] = [];
  const profiles = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-dev-profile-'));
    roots.push(root);
    const installed = path.join(root, 'installed');
    const development = path.join(root, 'development');
    fs.mkdirSync(installed);
    fs.mkdirSync(development);
    return { installed, development };
  };
  const writeState = (directory: string, state: unknown) =>
    fs.writeFileSync(path.join(directory, 'Local State'), JSON.stringify(state));
  const readState = (directory: string) =>
    JSON.parse(fs.readFileSync(path.join(directory, 'Local State'), 'utf8')) as LocalState;

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('gives a new development profile the installed key', () => {
    const { installed, development } = profiles();
    writeState(installed, { os_crypt: { encrypted_key: 'RFBBUElpbnN0YWxsZWQ=' } });

    expect(adoptInstalledSafeStorageKey(installed, development)).toBe(true);
    expect(readState(development).os_crypt?.encrypted_key).toBe('RFBBUElpbnN0YWxsZWQ=');
  });

  it('replaces a development key while keeping the rest of its Local State', () => {
    const { installed, development } = profiles();
    writeState(installed, { os_crypt: { encrypted_key: 'RFBBUElpbnN0YWxsZWQ=' } });
    writeState(development, { browser: { enabled_labs_experiments: [] }, os_crypt: { encrypted_key: 'RFBBUElkZXY=', audit_enabled: true } });

    expect(adoptInstalledSafeStorageKey(installed, development)).toBe(true);
    expect(readState(development)).toEqual({
      browser: { enabled_labs_experiments: [] },
      os_crypt: { encrypted_key: 'RFBBUElpbnN0YWxsZWQ=', audit_enabled: true },
    });
    expect(fs.readdirSync(development)).toEqual(['Local State']);
  });

  it('leaves the development profile alone when the keys already match or no installed key exists', () => {
    const { installed, development } = profiles();
    expect(adoptInstalledSafeStorageKey(installed, development)).toBe(false);
    expect(fs.existsSync(path.join(development, 'Local State'))).toBe(false);

    writeState(installed, { os_crypt: { encrypted_key: 'RFBBUElpbnN0YWxsZWQ=' } });
    writeState(development, { os_crypt: { encrypted_key: 'RFBBUElpbnN0YWxsZWQ=' } });
    expect(adoptInstalledSafeStorageKey(installed, development)).toBe(false);

    writeState(installed, { os_crypt: {} });
    expect(adoptInstalledSafeStorageKey(installed, development)).toBe(false);
  });
});
