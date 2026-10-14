import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Each backdrop has its own test; here only the mode choice and layer order matter.
vi.mock('@/components/focus-mode/FocusAmllBackdrop', () => ({
  default: () => <div data-focus-backdrop />,
}));
vi.mock('@/components/focus-mode/FocusCanvasBackdrop', () => ({
  default: () => <canvas data-focus-canvas-backdrop />,
}));

import FocusBackdrop from '@/components/focus-mode/FocusBackdrop';

const renderBackdrop = (amllBackground: boolean) => render(
  <FocusBackdrop
    amllBackground={amllBackground}
    trackId="t1"
    coverUrl="cover://a.jpg"
    isVisible
    isPlaying
    isLinux={false}
    opacity={1}
    blurRadius={80}
  />,
);

describe('FocusBackdrop', () => {
  it('shows the classic blurred cover by default mode', () => {
    const { container } = renderBackdrop(false);
    expect(container.querySelector('[data-focus-canvas-backdrop]')).not.toBeNull();
    expect(container.querySelector('[data-focus-backdrop]')).toBeNull();
  });

  it('switches to the AMLL mesh gradient under the same readability overlay', () => {
    const { container } = renderBackdrop(true);
    const backdrop = container.querySelector('[data-focus-backdrop]');
    const overlay = container.querySelector('[data-focus-backdrop-overlay]');
    expect(container.querySelector('[data-focus-canvas-backdrop]')).toBeNull();
    expect(backdrop?.compareDocumentPosition(overlay!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(overlay).toHaveClass('bg-gradient-to-b');
    expect(overlay).not.toHaveClass('backdrop-blur-sm');
  });
});
