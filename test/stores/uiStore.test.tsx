import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewMode } from '@/types';

const settings = vi.hoisted(() => ({
  mode: 'list' as 'list' | 'wall',
  setLibraryMode: vi.fn(),
}));

vi.mock('@/services/settingsManager', () => ({
  settingsManager: {
    getLibraryMode: () => settings.mode,
    setLibraryMode: settings.setLibraryMode,
    getGsapButtonBounce: () => false,
    subscribe: () => () => undefined,
  },
}));
// Navigation should apply immediately in tests; the transition itself is covered elsewhere.
vi.mock('@/hooks/useGsapPageTransition', () => ({
  useGsapPageTransition: (_view: ViewMode, setView: (mode: ViewMode) => void) => ({
    containerRef: { current: null },
    navigate: setView,
  }),
}));
vi.mock('@/hooks/useFloatingPanel', () => ({ useFloatingPanel: () => false }));

import { useUIStore } from '@/stores/uiStore';

describe('useUIStore library mode', () => {
  beforeEach(() => {
    settings.mode = 'list';
    settings.setLibraryMode.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('opens in the poster wall when that was the last library mode', () => {
    settings.mode = 'wall';
    const { result } = renderHook(() => useUIStore());
    expect(result.current.viewMode).toBe(ViewMode.WALL);
  });

  it('opens in the list otherwise', () => {
    const { result } = renderHook(() => useUIStore());
    expect(result.current.viewMode).toBe(ViewMode.PLAYER);
  });

  it('remembers the wall and the list, but not other views', () => {
    const { result } = renderHook(() => useUIStore());
    settings.setLibraryMode.mockClear();

    act(() => result.current.handleNavigate(ViewMode.WALL));
    expect(settings.setLibraryMode).toHaveBeenLastCalledWith('wall');

    settings.setLibraryMode.mockClear();
    act(() => result.current.handleNavigate(ViewMode.SETTINGS));
    expect(settings.setLibraryMode).not.toHaveBeenCalled();

    act(() => result.current.handleNavigate(ViewMode.PLAYER));
    expect(settings.setLibraryMode).toHaveBeenLastCalledWith('list');
  });
});
