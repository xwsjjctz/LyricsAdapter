import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TweenVars = { scale?: number; onComplete?: () => void; clearProps?: string };
const gsapMock = vi.hoisted(() => ({
  to: vi.fn<(target: HTMLElement, vars: TweenVars) => void>(),
  set: vi.fn<(target: HTMLElement, vars: TweenVars) => void>(),
  killTweensOf: vi.fn(),
}));

vi.mock('gsap', () => ({ gsap: gsapMock }));
vi.mock('@/services/settingsManager', () => ({
  settingsManager: { getGsapButtonBounce: () => true, subscribe: () => () => undefined },
}));

import { useGsapButtonBounce } from '@/hooks/useGsapButtonBounce';

// jsdom lacks PointerEvent, so dispatch a MouseEvent carrying `button`.
const press = (target: Element) => {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
};

function Harness() {
  useGsapButtonBounce();
  return <button type="button" style={{ transitionProperty: 'transform' }}>Play</button>;
}

describe('useGsapButtonBounce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('suspends transform transitions during a bounce and restores them once settled', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Play' });

    press(button);
    expect(button.style.transitionProperty).not.toContain('transform');
    expect(gsapMock.to).toHaveBeenCalledWith(button, expect.objectContaining({ scale: 0.93 }));

    window.dispatchEvent(new MouseEvent('pointerup'));
    const releaseTween = gsapMock.to.mock.calls.at(-1)?.[1];
    expect(releaseTween?.scale).toBe(1);

    releaseTween?.onComplete?.();
    expect(gsapMock.set).toHaveBeenCalledWith(button, { clearProps: 'transform' });
    expect(button.style.transitionProperty).toBe('transform');
  });

  it('ignores buttons that opt out', () => {
    render(<><Harness /><button type="button" data-no-gsap-bounce>Skip</button></>);
    press(screen.getByRole('button', { name: 'Skip' }));
    expect(gsapMock.to).not.toHaveBeenCalled();
  });
});
