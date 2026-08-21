import { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FocusBackdrop from '@/components/focus-mode/FocusBackdrop';

describe('FocusBackdrop', () => {
  it('can avoid the full-window compositor blur while keeping the gradient overlay', () => {
    const { container } = render(
      <FocusBackdrop
        hasBackground={false}
        isLinux={false}
        useCompositorBlur={false}
        canvasRef={createRef<HTMLCanvasElement>()}
      />,
    );

    const overlay = container.querySelector('[data-focus-backdrop-overlay]');
    expect(overlay).toHaveClass('bg-gradient-to-b');
    expect(overlay).not.toHaveClass('backdrop-blur-sm');
  });

  it('retains the secondary blur on platforms with an efficient compositor path', () => {
    const { container } = render(
      <FocusBackdrop
        hasBackground={false}
        isLinux={false}
        useCompositorBlur
        canvasRef={createRef<HTMLCanvasElement>()}
      />,
    );

    expect(container.querySelector('[data-focus-backdrop-overlay]'))
      .toHaveClass('backdrop-blur-sm');
  });
});
