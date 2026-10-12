// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ existsSync: vi.fn(), spawnSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));
import { getUpdaterUnavailableReason } from '../../../electron/services/updaterAvailability';

const packagedMac = {
  platform: 'darwin', isPackaged: true, resourcesPath: '/Applications/LyricsAdapter.app/Contents/Resources',
  executablePath: '/Applications/LyricsAdapter.app/Contents/MacOS/LyricsAdapter',
};

describe('installed-app update availability', () => {
  beforeEach(() => {
    mocks.existsSync.mockReset().mockReturnValue(true);
    mocks.spawnSync.mockReset().mockReturnValue({ status: 0, stderr: 'Authority=Developer ID Application: Example (TEAM123456)\n' });
  });

  it('does not inspect signatures or files in development', () => {
    expect(getUpdaterUnavailableReason({ ...packagedMac, isPackaged: false })).toBe('dev');
    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });

  it('requires embedded update configuration', () => {
    mocks.existsSync.mockReturnValue(false);
    expect(getUpdaterUnavailableReason(packagedMac)).toBe('unconfigured');
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });

  it.each([
    { status: 0, stderr: 'Signature=adhoc\n' },
    { status: 0, stderr: 'Authority=Apple Development: Example\n' },
    { status: 1, stderr: 'code object is not signed at all' },
    { status: null, stderr: null },
  ])('rejects a macOS package without an inspectable Developer ID identity: %j', signature => {
    mocks.spawnSync.mockReturnValue(signature);
    expect(getUpdaterUnavailableReason(packagedMac)).toBe('unsigned');
  });

  it('accepts Developer ID builds and inspects the app bundle', () => {
    expect(getUpdaterUnavailableReason(packagedMac)).toBeNull();
    expect(mocks.spawnSync).toHaveBeenCalledWith('/usr/bin/codesign',
      ['--display', '--verbose=2', path.resolve('/Applications/LyricsAdapter.app')], expect.objectContaining({ timeout: 5000 }));
  });

  it('preserves unsigned Windows updates and excludes unsupported platforms', () => {
    expect(getUpdaterUnavailableReason({ ...packagedMac, platform: 'win32' })).toBeNull();
    expect(getUpdaterUnavailableReason({ ...packagedMac, platform: 'linux' })).toBe('unsupported');
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });
});
