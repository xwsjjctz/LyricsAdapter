// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/mock/userData',
    isPackaged: false,
  },
}));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import {
  isCommandAvailable,
  getBundledBinaryPath,
  getBinaryPath,
} from '@/electron/utils/binaryUtils';
import { spawnSync } from 'child_process';

// ========== isCommandAvailable ==========
describe('isCommandAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when command exits with 0', () => {
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0 });
    expect(isCommandAvailable('ffmpeg', '-version')).toBe(true);
  });

  it('should return false when command exits with non-zero', () => {
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 1 });
    expect(isCommandAvailable('ffmpeg', '-version')).toBe(false);
  });

  it('should return false when spawn throws', () => {
    (spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(isCommandAvailable('nonexistent', '--version')).toBe(false);
  });
});

// ========== getBundledBinaryPath ==========
describe('getBundledBinaryPath', () => {
  const ORIG_PLATFORM = process.platform;
  const ORIG_ARCH = process.arch;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIG_PLATFORM, configurable: true });
    Object.defineProperty(process, 'arch', { value: ORIG_ARCH, configurable: true });
  });

  it('should return darwin-arm64 path on Mac ARM', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });

    const result = getBundledBinaryPath('metaflac', '/app/electron/utils');
    expect(result).toContain('binaries');
    expect(result).toContain('darwin-arm64');
    expect(result).toContain('metaflac');
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('should return darwin-x64 path on Mac Intel', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });

    const result = getBundledBinaryPath('ffmpeg', '/app/electron/utils');
    expect(result).toContain('darwin-x64');
    expect(result).toContain('ffmpeg');
  });

  it('should return win32-x64 path on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });

    const result = getBundledBinaryPath('ffmpeg', '/app/electron/utils');
    expect(result).toContain('win32-x64');
    expect(result).toContain('ffmpeg.exe');
  });

  it('should return linux-x64 path on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });

    const result = getBundledBinaryPath('ffmpeg', '/app/electron/utils');
    expect(result).toContain('linux-x64');
    expect(result).toContain('ffmpeg');
  });

  it('should throw on unsupported platform', () => {
    Object.defineProperty(process, 'platform', { value: 'android', configurable: true });

    expect(() => getBundledBinaryPath('ffmpeg', '/app/electron/utils')).toThrow('Unsupported platform');
  });

  it('should return dev path when app is not packaged', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });

    const result = getBundledBinaryPath('metaflac', '/app/electron/utils');
    expect(result).toContain('binaries/darwin-arm64');
    expect(result).not.toContain('Resources'); // Resources path is for packaged apps
  });
});

// ========== getBinaryPath ==========
describe('getBinaryPath', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return bundled path when bundled binary exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const result = getBinaryPath('ffmpeg', '/app/electron/utils');
    expect(result).toContain('ffmpeg');
    expect(fs.existsSync).toHaveBeenCalled();
  });

  it('should return system command when bundled is missing but system is available', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0 });

    const result = getBinaryPath('ffmpeg', '/app/electron/utils');
    expect(result).toBe('ffmpeg');
  });

  it('should throw when neither bundled nor system binary exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 1 });

    expect(() => getBinaryPath('ffmpeg', '/app/electron/utils')).toThrow(
      'ffmpeg binary not found'
    );
  });
});
