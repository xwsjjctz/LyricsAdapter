import { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FocusBackdrop from '@/components/focus-mode/FocusBackdrop';

describe('FocusBackdrop', () => {
  it('places the temporary Library blur below the prepared cover canvas', () => {
    const { container } = render(
      <FocusBackdrop
        hasBackground
        isLinux={false}
        blurUnderlyingView
        canvasRef={createRef<HTMLCanvasElement>()}
      />,
    );

    const libraryBlur = container.querySelector('[data-focus-library-backdrop-blur]');
    const canvas = container.querySelector('canvas');
    const overlay = container.querySelector('[data-focus-backdrop-overlay]');
    expect(libraryBlur).toHaveClass('backdrop-blur-sm');
    expect(libraryBlur?.compareDocumentPosition(canvas!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(overlay).toHaveClass('bg-gradient-to-b');
    expect(overlay).not.toHaveClass('backdrop-blur-sm');
  });

  it('removes the live Library blur after the transition', () => {
    const { container } = render(
      <FocusBackdrop
        hasBackground={false}
        isLinux={false}
        blurUnderlyingView={false}
        canvasRef={createRef<HTMLCanvasElement>()}
      />,
    );

    expect(container.querySelector('[data-focus-library-backdrop-blur]')).toBeNull();
  });
});
