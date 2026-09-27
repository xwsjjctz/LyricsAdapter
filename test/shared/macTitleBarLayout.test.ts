import { describe, expect, it } from 'vitest';
import { getMacTitleBarLayout } from '../../src/shared/macTitleBarLayout';

describe('getMacTitleBarLayout', () => {
  it('uses the legacy flat layout before macOS 26', () => {
    expect(getMacTitleBarLayout('24.6.0')).toMatchObject({ dotSize: 12.4, glossy: false });
    expect(getMacTitleBarLayout(undefined)).toMatchObject({ dotSize: 12.4, glossy: false });
  });

  it('uses the flat Tahoe layout on macOS 26', () => {
    expect(getMacTitleBarLayout('25.4.0')).toMatchObject({ dotSize: 14, glossy: false });
  });

  it('renders the glossy fourth light on macOS 27 and later', () => {
    expect(getMacTitleBarLayout('27.0.0')).toMatchObject({ dotSize: 14, sidebarLeft: 97, glossy: true });
  });
});
