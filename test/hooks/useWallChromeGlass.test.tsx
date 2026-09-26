import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WallChromeAction, WallChromeState } from '@/types/wallChrome';

const api = vi.hoisted(() => ({
  start: vi.fn(),
  update: vi.fn(),
  stop: vi.fn(),
  onAction: vi.fn(),
  emit: undefined as ((action: WallChromeAction) => void) | undefined,
}));
vi.mock('@/services/desktopAdapter', () => ({
  getDesktopAPI: () => ({ platform: 'darwin', ipc: { wallChrome: api } }),
}));

import { useWallChromeGlass } from '@/hooks/useWallChromeGlass';

const sections: WallChromeState['sections'] = [
  { title: 'Library', items: [{ id: 'slot:local', title: 'Local', count: 3, icon: 'local', checked: true, imageUrl: null }] },
];

function setup(anchor: HTMLElement | null) {
  const onBack = vi.fn();
  const onSelect = vi.fn();
  const hook = renderHook(() => useWallChromeGlass({
    anchorRef: { current: anchor }, title: 'Local', labels: { back: 'Back', source: 'Local, switch' }, sections, onBack, onSelect,
  }));
  return { ...hook, onBack, onSelect };
}

describe('useWallChromeGlass', () => {
  let anchor: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    api.start.mockResolvedValue({ ok: true, data: true });
    api.update.mockResolvedValue({ ok: true, data: undefined });
    api.stop.mockResolvedValue({ ok: true, data: undefined });
    api.onAction.mockImplementation((callback: (action: WallChromeAction) => void) => { api.emit = callback; return () => { api.emit = undefined; }; });
    anchor = document.createElement('div');
    document.body.appendChild(anchor);
    document.elementFromPoint = vi.fn(() => anchor);
  });
  afterEach(() => anchor.remove());

  it('stays on the web chrome when the native surface cannot start', async () => {
    api.start.mockResolvedValue({ ok: true, data: false });
    const { result } = setup(anchor);
    await waitFor(() => expect(api.start).toHaveBeenCalled());
    expect(result.current).toBe(false);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('sends the title, menu and a visible presentation once active', async () => {
    const { result } = setup(anchor);
    await waitFor(() => expect(result.current).toBe(true));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    const state = api.update.mock.calls.at(-1)![0] as WallChromeState;
    expect(state).toMatchObject({ title: 'Local', labels: { back: 'Back' }, sections });
    expect(state.presentation.opacity).toBe(1);
  });

  it('hides the native chrome while another layer covers the anchor', async () => {
    const cover = document.createElement('div');
    document.elementFromPoint = vi.fn(() => cover);
    const { result } = setup(anchor);
    await waitFor(() => expect(result.current).toBe(true));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect((api.update.mock.calls.at(-1)![0] as WallChromeState).presentation.opacity).toBe(0);
  });

  it('routes native intents and stops the surface on unmount', async () => {
    const { result, onBack, onSelect, unmount } = setup(anchor);
    await waitFor(() => expect(result.current).toBe(true));
    act(() => api.emit?.({ type: 'select', id: 'playlist:qq:1' }));
    act(() => api.emit?.({ type: 'back', id: '' }));
    expect(onSelect).toHaveBeenCalledWith('playlist:qq:1');
    expect(onBack).toHaveBeenCalledOnce();
    unmount();
    expect(api.stop).toHaveBeenCalled();
  });
});
