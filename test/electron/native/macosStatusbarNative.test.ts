import { describe, expect, it, vi } from 'vitest';
import {
  loadMacosStatusbarNativeBridge,
  validateMacosStatusbarNativeBridge,
} from '@/../electron/native/macosStatusbarNative';

function bridge(apiVersion = 1) {
  return {
    getApiVersion: vi.fn(() => apiVersion),
    startStatusItem: vi.fn(),
    updateStatusItem: vi.fn(),
    stopStatusItem: vi.fn(),
  };
}

describe('macOS status bar native bridge loader', () => {
  it.runIf(process.platform === 'darwin')('loads the bundled Node-API prebuild', () => {
    const nativeBridge = loadMacosStatusbarNativeBridge();
    expect(nativeBridge?.getApiVersion()).toBe(1);
  });

  it('does not load the macOS-only package on other platforms', () => {
    const load = vi.fn();
    expect(loadMacosStatusbarNativeBridge('win32', load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('accepts the expected narrow API on macOS', () => {
    const candidate = bridge();
    expect(loadMacosStatusbarNativeBridge('darwin', () => candidate)).toBe(candidate);
  });

  it('rejects missing functions and incompatible API versions', () => {
    expect(() => validateMacosStatusbarNativeBridge({})).toThrow('invalid API');
    expect(() => validateMacosStatusbarNativeBridge(bridge(2))).toThrow(
      'version mismatch',
    );
  });
});
