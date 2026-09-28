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

describe('useUIStore home page', () => {
  beforeEach(() => {
    settings.mode = 'list';
    settings.setLibraryMode.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('always opens on the poster wall, even if the list was last used', () => {
    const { result } = renderHook(() => useUIStore());
    expect(result.current.viewMode).toBe(ViewMode.WALL);
  });

  it('no longer persists a library presentation', () => {
    const { result } = renderHook(() => useUIStore());
    act(() => result.current.handleNavigate(ViewMode.SEARCH));
    act(() => result.current.handleNavigate(ViewMode.WALL));
    expect(result.current.viewMode).toBe(ViewMode.WALL);
    expect(settings.setLibraryMode).not.toHaveBeenCalled();
  });

  it('shows the saved library layout and persists only an explicit switch', () => {
    const { result } = renderHook(() => useUIStore());
    expect(result.current.libraryLayout).toBe('list');
    act(() => result.current.setLibraryLayout('wall'));
    expect(result.current.libraryLayout).toBe('wall');
    expect(settings.setLibraryMode).toHaveBeenCalledWith('wall');
  });

  it('opens settings as a sheet over the current wall', () => {
    const { result } = renderHook(() => useUIStore());
    act(() => result.current.handleNavigate(ViewMode.SEARCH));
    act(() => result.current.openSettings('cloud'));
    expect(result.current.settingsSection).toBe('cloud');
    expect(result.current.viewMode).toBe(ViewMode.SEARCH);
    act(() => result.current.closeSettings());
    expect(result.current.settingsSection).toBeNull();
    act(() => result.current.openSettings());
    act(() => result.current.handleNavigate(ViewMode.WALL));
    expect(result.current.settingsSection).toBeNull();
  });
});
