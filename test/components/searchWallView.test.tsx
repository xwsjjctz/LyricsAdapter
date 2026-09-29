import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchWallView from '@/components/search/SearchWallView';
import i18n from '@/services/i18n';
import { settingsManager } from '@/services/settingsManager';
import type { Track } from '@/types';

// Tweens finish at once so a filter change swaps the posters synchronously.
vi.mock('gsap', () => ({
  gsap: {
    to: vi.fn((_targets: unknown, vars: { onComplete?: () => void }) => vars.onComplete?.()),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

function track(id: string, title: string): Track {
  return { id, title, artist: 'Artist', album: 'Album', duration: 125, audioUrl: '', source: 'local' };
}

const LOCAL = i18n.t('sidebar.local');
const CLOUD = i18n.t('sidebar.cloud');
const localTracks = Array.from({ length: 3 }, (_, index) => track(`l${index}`, `Hello ${index}`));
const cloudTracks = [track('c0', 'Hello cloud')];
const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

function renderView(overrides: Partial<Parameters<typeof SearchWallView>[0]> = {}) {
  const props = {
    query: 'hello',
    localTracks,
    cloudTracks,
    onNavigateToTrack: vi.fn(),
    onOnlineStreamPlay: vi.fn(),
    onDownloadTrack: vi.fn(),
    onEditQuery: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<SearchWallView {...props} />), props };
}

const tileLabel = (t: Track) => i18n.t('wall.tileLabel', { title: t.title, artist: t.artist });

describe('SearchWallView', () => {
  beforeEach(() => {
    vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(false);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows every match as a poster with counts per source', () => {
    renderView();
    expect(screen.getByRole('button', { name: tileLabel(localTracks[0]!) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tileLabel(cloudTracks[0]!) })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: new RegExp(LOCAL) })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: new RegExp(CLOUD) })).toHaveTextContent('1');
  });

  it('filters the wall to one source', () => {
    renderView();
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(CLOUD) }));
    expect(screen.queryByRole('button', { name: tileLabel(localTracks[0]!) })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: tileLabel(cloudTracks[0]!) })).toBeInTheDocument();
  });

  it('plays a library result through navigation', () => {
    const { props } = renderView();
    fireEvent.click(screen.getByRole('button', { name: tileLabel(localTracks[2]!) }));
    expect(props.onNavigateToTrack).toHaveBeenCalledWith(localTracks[2]);
  });

  it('returns to the wall with Esc and reopens the palette from the query', () => {
    const { props } = renderView();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('search.editQuery') }));
    expect(props.onEditQuery).toHaveBeenCalled();
  });

  it('explains when nothing matches', () => {
    renderView({ query: 'zzz-no-match' });
    expect(screen.getByText(i18n.t('search.noResults'))).toBeInTheDocument();
  });
});
