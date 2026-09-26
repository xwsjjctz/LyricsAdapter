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
});
