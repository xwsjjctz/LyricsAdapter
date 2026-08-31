import { describe, expect, it, vi } from 'vitest';
import {
  loadWindowsTaskbarNativeBridge,
  validateWindowsTaskbarNativeBridge,
} from '@/../electron/native/windowsTaskbarNative';

function bridge(apiVersion = 2) {
  return {
    getApiVersion: vi.fn(() => apiVersion),
    attachTaskbarWindow: vi.fn(),
    detachTaskbarWindow: vi.fn(),
    setTaskbarWindowVisible: vi.fn(),
  };
}

describe('Windows taskbar native bridge loader', () => {
  it.runIf(process.platform === 'win32')('loads the source-built Node-API module', () => {
    const nativeBridge = loadWindowsTaskbarNativeBridge();
    expect(nativeBridge?.getApiVersion()).toBe(2);
  });

  it('does not load the Windows-only package on other platforms', () => {
    const load = vi.fn();
    expect(loadWindowsTaskbarNativeBridge('linux', load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('accepts the expected narrow API on Windows', () => {
    const candidate = bridge();
    expect(loadWindowsTaskbarNativeBridge('win32', () => candidate)).toBe(candidate);
  });

  it('rejects missing functions and incompatible API versions', () => {
    expect(() => validateWindowsTaskbarNativeBridge({})).toThrow('invalid API');
    expect(() => validateWindowsTaskbarNativeBridge(bridge(1))).toThrow(
      'version mismatch',
    );
  });
});
