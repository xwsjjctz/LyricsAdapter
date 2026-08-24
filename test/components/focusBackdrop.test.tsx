import { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FocusBackdrop from '@/components/focus-mode/FocusBackdrop';

describe('FocusBackdrop', () => {
  it('retains the secondary blur over the pre-blurred backdrop', () => {
    const { container } = render(
      <FocusBackdrop
        hasBackground={false}
        isLinux={false}
        canvasRef={createRef<HTMLCanvasElement>()}
      />,
    );

    expect(container.querySelector('[data-focus-backdrop-overlay]'))
      .toHaveClass('backdrop-blur-sm');
  });
});
