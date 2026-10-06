import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerControlbarLayout } from '@/hooks/usePlayerControlbarLayout';

let width = 1200;
const queries = new Map<string, { max: number; listeners: Set<() => void>; query: MediaQueryList }>();

beforeEach(() => {
  width = 1200;
  queries.clear();
  window.matchMedia = vi.fn((media: string) => {
    let entry = queries.get(media);
    if (!entry) {
      const max = Number(media.match(/\d+/)![0]);
      const listeners = new Set<() => void>();
      const query = { media, get matches() { return width <= max; },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      } as unknown as MediaQueryList;
      entry = { max, listeners, query };
      queries.set(media, entry);
    }
    return entry.query;
  });
});

function resize(next: number) {
  act(() => {
    const previous = width;
    width = next;
    for (const { max, listeners } of queries.values()) {
      if ((previous <= max) !== (width <= max)) for (const listener of listeners) listener();
    }
  });
}

describe('normal player presentation stages', () => {
  it('keeps progress through the middle stage and restores controls when widening', () => {
    const { result } = renderHook(usePlayerControlbarLayout);
    for (const [next, layout] of [[680, 'full'], [679, 'reduced'], [560, 'reduced'], [559, 'compact'],
      [360, 'compact'], [560, 'reduced'], [680, 'full']] as const) {
      resize(next);
      expect(result.current).toBe(layout);
    }
  });

  it('starts in the correct stage and does not rerender for individual resize pixels', () => {
    width = 600;
    const renders = vi.fn();
    const { result } = renderHook(() => { renders(); return usePlayerControlbarLayout(); });
    expect(result.current).toBe('reduced');
    renders.mockClear();
    resize(610); resize(630); resize(670);
    expect(renders).not.toHaveBeenCalled();
  });

  it('handles crossing both boundaries in one event and releases its listeners', () => {
    const { result, unmount } = renderHook(usePlayerControlbarLayout);
    resize(393);
    expect(result.current).toBe('compact');
    resize(1200);
    expect(result.current).toBe('full');
    unmount();
    expect([...queries.values()].every(entry => entry.listeners.size === 0)).toBe(true);
  });
});
