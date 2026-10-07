import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissStartupScreen, revealStartupScreen } from '@/services/startupScreen';

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const paint = () => {
  const pending = [...frames.values()]; frames.clear();
  pending.forEach(callback => callback(performance.now()));
};
const advanceToReveal = async () => {
  await vi.advanceTimersByTimeAsync(400);
  paint(); paint();
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  frames.clear(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  document.body.innerHTML = '<div id="app-startup"><img></div><div id="root" inert aria-hidden="true"></div>';
  document.documentElement.dataset['startup'] = 'loading';
  Object.defineProperty(document.querySelector('img'), 'decode', { value: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('startup screen', () => {
  it('waits for artwork and committed layout, then releases interaction after the background fades', async () => {
    let resolveArtwork!: () => void;
    const artwork = new Promise<void>(resolve => { resolveArtwork = resolve; });
    vi.mocked(document.querySelector('img')!.decode).mockReturnValue(artwork);
    const cleanup = revealStartupScreen();
    await advanceToReveal();
    expect(document.documentElement.dataset['startup']).toBe('loading');
    resolveArtwork();
    await advanceToReveal();
    expect(document.documentElement.dataset['startup']).toBe('revealing');
    expect(document.getElementById('root')).toHaveAttribute('inert');
    const screen = document.getElementById('app-startup')!;
    const end = new Event('animationend', { bubbles: true });
    Object.defineProperty(end, 'animationName', { value: 'startup-reveal' });
    screen.dispatchEvent(end);
    expect(document.getElementById('app-startup')).toBeNull();
    expect(document.getElementById('root')).not.toHaveAttribute('inert');
    expect(document.getElementById('root')).not.toHaveAttribute('aria-hidden');
    cleanup();
  });
  it('releases on the fallback even if assets fail or animationend is lost', async () => {
    vi.mocked(document.querySelector('img')!.decode).mockRejectedValue(new Error('missing image'));
    revealStartupScreen(); await advanceToReveal();
    await vi.advanceTimersByTimeAsync(800);
    expect(document.getElementById('app-startup')).toBeNull();
    expect(document.documentElement.dataset['startup']).toBe('ready');
  });
  it('does not reveal after cancellation and can expose a startup error immediately', async () => {
    revealStartupScreen()(); await advanceToReveal();
    expect(document.documentElement.dataset['startup']).toBe('loading');
    dismissStartupScreen();
    expect(document.getElementById('app-startup')).toBeNull();
    expect(document.getElementById('root')).not.toHaveAttribute('aria-hidden');
  });
});
