import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  configureDevelopmentProfile,
  DEVELOPMENT_USER_DATA_DIRECTORY,
} from '../../electron/developmentProfile';

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
      getPath: vi.fn(() => 'C:\\Users\\tester\\AppData\\Roaming'),
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
    );

    const expected = path.join(
      'C:\\Users\\tester\\AppData\\Roaming',
      DEVELOPMENT_USER_DATA_DIRECTORY,
    );
    expect(result).toBe(expected);
    expect(ensureDirectory).toHaveBeenCalledWith(expected);
    expect(setPath).toHaveBeenCalledWith('userData', expected);
  });

  it('does not change the packaged application profile', () => {
    const { app, setPath } = createApp({ isPackaged: true });
    const ensureDirectory = vi.fn();

    expect(configureDevelopmentProfile(app as never, ensureDirectory)).toBeNull();
    expect(ensureDirectory).not.toHaveBeenCalled();
    expect(setPath).not.toHaveBeenCalled();
  });

  it('preserves an explicit user-data-dir used by isolated test launches', () => {
    const { app, setPath } = createApp({
      hasExplicitUserDataDirectory: true,
    });
    const ensureDirectory = vi.fn();

    expect(configureDevelopmentProfile(app as never, ensureDirectory)).toBeNull();
    expect(ensureDirectory).not.toHaveBeenCalled();
    expect(setPath).not.toHaveBeenCalled();
  });
});
