import { describe, expect, it } from 'vitest';
import {
  WINDOWS_TITLE_BAR_HEIGHT,
  getWindowsBuild,
  getWindowsTitleBarOverlay,
  isWindowChromeAppearance,
  supportsWindowsSystemBackdrop,
} from '../../src/shared/windowsChrome';

describe('windowsChrome', () => {
  it('reads the build number from a Windows kernel release', () => {
    expect(getWindowsBuild('10.0.22631')).toBe(22631);
    expect(getWindowsBuild('10.0')).toBe(0);
    expect(getWindowsBuild(undefined)).toBe(0);
  });

  it('enables Mica only from Windows 11 22H2', () => {
    expect(supportsWindowsSystemBackdrop('10.0.19045')).toBe(false);
    expect(supportsWindowsSystemBackdrop('10.0.22000')).toBe(false);
    expect(supportsWindowsSystemBackdrop('10.0.22621')).toBe(true);
    expect(supportsWindowsSystemBackdrop('10.0.26100')).toBe(true);
  });

  it('keeps the caption buttons transparent and recolours only their glyphs', () => {
    expect(getWindowsTitleBarOverlay('dark')).toEqual({
      color: '#00000000', symbolColor: '#ffffff', height: WINDOWS_TITLE_BAR_HEIGHT,
    });
    expect(getWindowsTitleBarOverlay('light').symbolColor).toBe('#1b1b1b');
  });

  it('accepts only a complete appearance from the renderer', () => {
    expect(isWindowChromeAppearance({ theme: 'light', captions: 'dark' })).toBe(true);
    expect(isWindowChromeAppearance({ theme: 'light' })).toBe(false);
    expect(isWindowChromeAppearance({ theme: 'sepia', captions: 'dark' })).toBe(false);
    expect(isWindowChromeAppearance(null)).toBe(false);
  });
});
