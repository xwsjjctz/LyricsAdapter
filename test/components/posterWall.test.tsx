import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';

type Tween = { targets: HTMLElement[]; vars: { onComplete?: () => void; opacity?: number } };
const gsapMock = vi.hoisted(() => {
  const calls: { to: Tween[]; fromTo: Tween[] } = { to: [], fromTo: [] };
  return {
    calls,
    gsap: {
      to: vi.fn((targets: HTMLElement[], vars: Tween['vars']) => { calls.to.push({ targets, vars }); }),
      fromTo: vi.fn((targets: HTMLElement[], _from: unknown, vars: Tween['vars']) => { calls.fromTo.push({ targets, vars }); }),
      set: vi.fn(),
      killTweensOf: vi.fn(),
    },
  };
});

vi.mock('gsap', () => ({ gsap: gsapMock.gsap }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, string>) => (values ? `${values['title']} / ${values['artist']}` : key) }),
}));

import PosterWall from '@/components/wall/PosterWall';

const track = (id: string): Track => ({ id, title: `Song ${id}`, artist: 'Artist', album: 'Album', duration: 60, audioUrl: '' });
const local = ['a', 'b', 'c', 'd'].map(track);
const online = ['x', 'y'].map(track);

const size = { width: 1200, height: 800 };
const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => size.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => size.height });
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

beforeEach(() => {
  gsapMock.calls.to.length = 0;
  gsapMock.calls.fromTo.length = 0;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});

function renderWall(props: Partial<React.ComponentProps<typeof PosterWall>> = {}) {
  const onTrackSelect = vi.fn();
  const base = {
    tracks: local, sourceKey: 'local', emptyLabel: 'empty', loadingLabel: 'loading',
    onTrackSelect, hasMenu: () => true, onOpenMenu: vi.fn(),
  };
  const view = render(<PosterWall {...base} {...props} />);
  return { ...view, onTrackSelect, rerenderWall: (next: Partial<React.ComponentProps<typeof PosterWall>>) => view.rerender(<PosterWall {...base} {...props} {...next} />) };
}

const tileNames = () => screen.getAllByRole('button').map(tile => tile.getAttribute('aria-label'));

describe('PosterWall', () => {
  it('renders a tile per track and plays the clicked one', () => {
    const { onTrackSelect } = renderWall();
    expect(tileNames()).toEqual(local.map(t => `${t.title} / Artist`));
    fireEvent.click(screen.getByRole('button', { name: 'Song c / Artist' }));
    expect(onTrackSelect).toHaveBeenCalledWith(2);
  });

  it('plays on plain Enter only, leaving Cmd+Enter and Space to global shortcuts', () => {
    const { onTrackSelect } = renderWall();
    const tile = screen.getByRole('button', { name: 'Song b / Artist' });
    fireEvent.keyDown(tile, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(tile, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(tile, { key: ' ' });
    expect(onTrackSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(onTrackSelect).toHaveBeenCalledWith(1);
  });

  it('marks the playing track in place without moving any tile', () => {
    const { rerenderWall } = renderWall();
    const geometry = () => screen.getAllByRole('button').map(tile => [tile.style.transform, tile.style.width]);
    const before = geometry();
    rerenderWall({ currentTrackId: 'c' });
    expect(geometry()).toEqual(before);
    expect(tileNames()).toEqual(local.map(t => `${t.title} / Artist`));
    expect(screen.getByRole('button', { name: 'Song c / Artist' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getAllByRole('button').filter(tile => tile.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('pops the first source in on mount', () => {
    renderWall();
    expect(gsapMock.calls.fromTo).toHaveLength(1);
    expect(gsapMock.calls.fromTo[0]!.targets).toHaveLength(local.length);
  });

  it('keeps the outgoing tiles until they sink, then pops the new source in', () => {
    const { rerenderWall } = renderWall();
    rerenderWall({ tracks: online, sourceKey: 'online' });

    expect(tileNames()).toEqual(local.map(t => `${t.title} / Artist`));
    const exit = gsapMock.calls.to.at(-1)!;
    expect(exit.vars.opacity).toBe(0);
    expect(exit.targets).toHaveLength(local.length);

    act(() => exit.vars.onComplete?.());
    expect(tileNames()).toEqual(online.map(t => `${t.title} / Artist`));
    expect(gsapMock.calls.fromTo.at(-1)!.targets).toHaveLength(online.length);
  });

  it('replays the entrance when switching back before the exit finishes', () => {
    const { rerenderWall } = renderWall();
    const entrancesBefore = gsapMock.calls.fromTo.length;
    rerenderWall({ tracks: online, sourceKey: 'online' });
    rerenderWall({ tracks: local, sourceKey: 'local' });
    act(() => gsapMock.calls.to.at(-1)!.vars.onComplete?.());
    expect(tileNames()).toEqual(local.map(t => `${t.title} / Artist`));
    expect(gsapMock.calls.fromTo.length).toBe(entrancesBefore + 1);
  });

  it('waits for a loading source before popping in', () => {
    const { rerenderWall } = renderWall();
    rerenderWall({ tracks: [], sourceKey: 'playlist:qq:1', loading: true });
    act(() => gsapMock.calls.to.at(-1)!.vars.onComplete?.());
    expect(screen.getByText('loading')).toBeInTheDocument();
    const entrances = gsapMock.calls.fromTo.length;

    rerenderWall({ tracks: online, sourceKey: 'playlist:qq:1', loading: false });
    expect(gsapMock.calls.fromTo.length).toBe(entrances + 1);
    expect(tileNames()).toHaveLength(online.length);
  });
  it('keeps loading pages without a scroll while the wall ends within a viewport of the bottom', () => {
    const onLoadMore = vi.fn();
    const { rerenderWall } = renderWall({ tracks: online, hasMore: true, onLoadMore });
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerenderWall({ tracks: online, hasMore: true, onLoadMore, loading: true });
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // The page landed while the user stayed at the bottom: fetch the next one.
    rerenderWall({ tracks: [...online, track('z')], hasMore: true, onLoadMore, loading: false });
    expect(onLoadMore).toHaveBeenCalledTimes(2);

    rerenderWall({ tracks: [...online, track('z'), track('w')], hasMore: false, onLoadMore });
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed page on its own, only when the user scrolls', () => {
    const onLoadMore = vi.fn();
    const { container } = renderWall({ tracks: online, hasMore: true, onLoadMore, loadError: true });
    expect(onLoadMore).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      fireEvent.scroll(container.querySelector('.poster-wall')!);
      act(() => { vi.runAllTimers(); });
    } finally {
      vi.useRealTimers();
    }
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('toggles selection instead of playing while selecting', () => {
    const onToggleSelect = vi.fn();
    const { onTrackSelect } = renderWall({ selecting: true, selectedIds: new Set(['b']), onToggleSelect });
    const tiles = screen.getAllByRole('checkbox');
    expect(tiles).toHaveLength(local.length);
    expect(tiles[1]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(tiles[0]!);
    expect(onToggleSelect).toHaveBeenCalledWith(local[0]);
    expect(onTrackSelect).not.toHaveBeenCalled();
  });

  it('swaps two tiles when one is dropped onto the other', () => {
    const onSwap = vi.fn();
    renderWall({ onSwap });
    const tiles = screen.getAllByRole('button');
    expect(tiles[0]).toHaveAttribute('draggable', 'true');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(tiles[0]!, { dataTransfer });
    fireEvent.dragOver(tiles[2]!, { dataTransfer });
    expect(tiles[2]!.className).toContain('wall-tile--drag-target');
    fireEvent.drop(tiles[2]!, { dataTransfer });
    expect(onSwap).toHaveBeenCalledWith(0, 2);
  });

  it('does not offer dragging without a swap handler or while selecting', () => {
    const { rerenderWall } = renderWall();
    expect(screen.getAllByRole('button')[0]).toHaveAttribute('draggable', 'false');
    rerenderWall({ onSwap: vi.fn(), selecting: true, selectedIds: new Set() });
    expect(screen.getAllByRole('checkbox')[0]).toHaveAttribute('draggable', 'false');
  });
});

describe('PosterWall locating the playing tile', () => {
  const many = Array.from({ length: 60 }, (_, index) => track(`t${index}`));
  const setup = (props: Partial<React.ComponentProps<typeof PosterWall>> = {}) => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    const view = renderWall({ tracks: many, sourceKey: 'many', ...props });
    return { ...view, scrollTo };
  };

  it('follows a track switch only when the playing tile is out of view', () => {
    const { rerenderWall, scrollTo } = setup({ currentTrackId: 't0', autoLocateToken: 0 });
    rerenderWall({ tracks: many, sourceKey: 'many', currentTrackId: 't1', autoLocateToken: 1 });
    expect(scrollTo).not.toHaveBeenCalled(); // Still on screen.

    rerenderWall({ tracks: many, sourceKey: 'many', currentTrackId: 't59', autoLocateToken: 2 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const call = scrollTo.mock.calls[0]![0] as ScrollToOptions;
    expect(call.behavior).toBe('smooth');
    expect(call.top).toBeGreaterThan(0);
  });

  it('centres the playing tile for an explicit request and acknowledges it', () => {
    const onLocateRequestHandled = vi.fn();
    const { scrollTo } = setup({
      currentTrackId: 't40', locateRequest: { token: 7, smooth: true }, onLocateRequestHandled,
    });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    expect(onLocateRequestHandled).toHaveBeenCalledWith(7);
  });

  it('acknowledges a request even when the playing track is not in this list', () => {
    const onLocateRequestHandled = vi.fn();
    const { scrollTo } = setup({
      currentTrackId: 'elsewhere', locateRequest: { token: 3, smooth: false }, onLocateRequestHandled,
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(onLocateRequestHandled).toHaveBeenCalledWith(3);
  });

  it('marks the playing tile with an accent badge', () => {
    setup({ currentTrackId: 't0' });
    const current = document.querySelector('[aria-current="true"]');
    expect(current).toHaveClass('wall-tile--current');
    expect(current?.querySelector('.wall-tile__badge')).toHaveTextContent('library.nowPlaying');
  });
});

describe('PosterWall remembering its scroll offset', () => {
  const many = Array.from({ length: 60 }, (_, index) => track(`r${index}`));
  const wallScroll = () => (document.querySelector('.poster-wall') as HTMLElement).scrollTop;

  it('reopens at the saved offset without locating the playing tile', () => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    renderWall({ tracks: many, sourceKey: 'saved', currentTrackId: 'r59', restoreScrollTop: 900 });
    expect(wallScroll()).toBe(900);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('waits for tracks and uses an offset restored after mount', () => {
    const { rerenderWall } = renderWall({ tracks: [], sourceKey: 'late', restoreScrollTop: 0 });
    rerenderWall({ tracks: [], sourceKey: 'late', restoreScrollTop: 700 });
    rerenderWall({ tracks: many, sourceKey: 'late', restoreScrollTop: 700 });
    expect(wallScroll()).toBe(700);
  });

  it('clamps a saved offset beyond the end', () => {
    renderWall({ tracks: many, sourceKey: 'clamp', restoreScrollTop: 999_999 });
    expect(wallScroll()).toBeGreaterThan(0);
    expect(wallScroll()).toBeLessThan(999_999);
  });

  it('lets a pending locate decide where the source opens', () => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    renderWall({
      tracks: many, sourceKey: 'locate', currentTrackId: 'r50', restoreScrollTop: 300,
      locateRequest: { token: 1, smooth: false }, onLocateRequestHandled: vi.fn(),
    });
    expect(wallScroll()).not.toBe(300);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('reports user scrolling, not the reset to the top on entry', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length; });
    const onScrollPositionChange = vi.fn();
    renderWall({ tracks: many, sourceKey: 'report', restoreScrollTop: 400, onScrollPositionChange });
    const wall = document.querySelector('.poster-wall') as HTMLElement;
    wall.scrollTop = 650;
    fireEvent.scroll(wall);
    act(() => frames.splice(0).forEach(cb => cb(0)));
    expect(onScrollPositionChange).toHaveBeenCalledWith(650);
    expect(onScrollPositionChange).not.toHaveBeenCalledWith(0);
    vi.restoreAllMocks();
  });
});
