import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const amll = vi.hoisted(() => {
  const canvas = document.createElement('canvas');
  const loseContext = vi.fn();
  canvas.getContext = vi.fn(() => ({ getExtension: () => ({ loseContext }) })) as unknown as HTMLCanvasElement['getContext'];
  const renderer = {
    getElement: vi.fn(() => canvas),
    setRenderScale: vi.fn(),
    setFPS: vi.fn(),
    setStaticMode: vi.fn(),
    setLowFreqVolume: vi.fn(),
    setAlbum: vi.fn(async (_image: HTMLImageElement) => undefined),
    dispose: vi.fn(() => canvas.remove()),
  };
  return { canvas, loseContext, renderer };
});

vi.mock('@applemusic-like-lyrics/core', () => ({
  BackgroundRender: { new: vi.fn(() => amll.renderer) },
  MeshGradientRenderer: class {},
}));

import FocusAmllBackdrop from '@/components/focus-mode/FocusAmllBackdrop';
import { DEFAULT_COVER_ARTWORK_URL } from '@/services/coverUrl';

/** Images settle on the next microtask; URLs in `failing` report an error. */
const failing = new Set<string>();
class FakeImage {
  crossOrigin: string | null = null;
  decoding = 'auto';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private url = '';
  get src(): string { return this.url; }
  set src(value: string) {
    this.url = value;
    queueMicrotask(() => (failing.has(value) ? this.onerror?.() : this.onload?.()));
  }
}

beforeEach(() => {
  failing.clear();
  vi.stubGlobal('Image', FakeImage);
  // Reduced motion keeps the test off the audio tap and animation frames.
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  Object.values(amll.renderer).forEach(fn => fn.mockClear());
  amll.loseContext.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FocusAmllBackdrop', () => {
  it('mounts the AMLL canvas in DOM order and loads the album with CORS', async () => {
    const { container } = render(<FocusAmllBackdrop coverUrl="cover://album.jpg" isVisible isPlaying opacity={1} />);

    const host = container.querySelector('[data-focus-backdrop]');
    expect(host?.firstChild).toBe(amll.canvas);
    // Opaque and constant: the poster wall must never show through.
    expect(host).toHaveClass('bg-black');
    expect(host).toHaveStyle({ opacity: '1' });
    expect(amll.canvas.style.zIndex).toBe('auto');
    expect(amll.renderer.setRenderScale).toHaveBeenCalledWith(0.5);

    await waitFor(() => expect(amll.renderer.setAlbum).toHaveBeenCalledTimes(1));
    const image = amll.renderer.setAlbum.mock.calls[0]![0] as unknown as FakeImage;
    expect(image.crossOrigin).toBe('anonymous');
    expect(image.src).toContain('cover://album.jpg');
    await waitFor(() => expect(host).toHaveAttribute('data-focus-backdrop-cover', 'cover://album.jpg'));
  });

  it('falls back to the default artwork when a cover is not CORS-readable', async () => {
    failing.add('https://cdn.example/cover.jpg');
    render(<FocusAmllBackdrop coverUrl="https://cdn.example/cover.jpg" isVisible isPlaying opacity={1} />);

    await waitFor(() => expect(amll.renderer.setAlbum).toHaveBeenCalledTimes(1));
    const image = amll.renderer.setAlbum.mock.calls[0]![0] as unknown as FakeImage;
    expect(image.src).toBe(DEFAULT_COVER_ARTWORK_URL);
  });

  it('waits until FocusMode is presented before loading an album', async () => {
    const { rerender } = render(<FocusAmllBackdrop coverUrl="cover://album.jpg" isVisible={false} isPlaying opacity={1} />);
    await Promise.resolve();
    expect(amll.renderer.setAlbum).not.toHaveBeenCalled();

    rerender(<FocusAmllBackdrop coverUrl="cover://album.jpg" isVisible isPlaying opacity={1} />);
    await waitFor(() => expect(amll.renderer.setAlbum).toHaveBeenCalledTimes(1));
  });

  it('stays static under reduced motion and releases WebGL on unmount', () => {
    const { unmount } = render(<FocusAmllBackdrop coverUrl="cover://album.jpg" isVisible isPlaying opacity={1} />);
    expect(amll.renderer.setStaticMode).toHaveBeenLastCalledWith(true);
    expect(amll.renderer.setStaticMode).not.toHaveBeenCalledWith(false);

    unmount();
    expect(amll.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(amll.loseContext).toHaveBeenCalledTimes(1);
  });
});
