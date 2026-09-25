import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchBox from '@/components/SearchBox';
import { cookieManager } from '@/services/cookieManager';
import { neteaseMusicApi } from '@/services/neteaseMusicApi';
import type { OnlineSong } from '@/services/onlineMusicProvider';
import { settingsManager } from '@/services/settingsManager';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function song(songmid: string, songname: string): OnlineSong {
  return {
    songmid,
    songname,
    singer: [{ name: 'Singer' }],
    interval: 180,
  };
}

function renderSearchBox(overrides: Partial<ComponentProps<typeof SearchBox>> = {}) {
  const props: ComponentProps<typeof SearchBox> = {
    localTracks: [],
    cloudTracks: [],
    onNavigateToTrack: vi.fn(),
    onOnlineStreamPlay: vi.fn(),
    onDownloadTrack: vi.fn(),
    onlineProgress: {},
    onOpenResults: vi.fn(),
    ...overrides,
  };
  return { ...render(<SearchBox {...props} />), props };
}

describe('SearchBox online result freshness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(true);
    vi.spyOn(cookieManager, 'hasCookie').mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ignores an older request that resolves after the current query', async () => {
    const firstRequest = deferred<OnlineSong[]>();
    const secondRequest = deferred<OnlineSong[]>();
    vi.spyOn(neteaseMusicApi, 'searchMusic').mockImplementation(query => (
      query === 'first' ? firstRequest.promise : secondRequest.promise
    ));

    renderSearchBox();
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'first' } });
    await act(async () => vi.advanceTimersByTime(500));

    fireEvent.change(input, { target: { value: 'second' } });
    await act(async () => vi.advanceTimersByTime(500));

    await act(async () => secondRequest.resolve([song('second-id', 'Second result')]));
    expect(screen.getByText('Second result')).toBeInTheDocument();

    await act(async () => firstRequest.resolve([song('first-id', 'Stale first result')]));
    expect(screen.queryByText('Stale first result')).not.toBeInTheDocument();
    expect(screen.getByText('Second result')).toBeInTheDocument();
  });

  it('clears results from the previous query while the next query is loading', async () => {
    const secondRequest = deferred<OnlineSong[]>();
    vi.spyOn(neteaseMusicApi, 'searchMusic').mockImplementation(query => (
      query === 'first'
        ? Promise.resolve([song('first-id', 'First result')])
        : secondRequest.promise
    ));

    renderSearchBox();
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'first' } });
    await act(async () => vi.advanceTimersByTime(500));
    expect(screen.getByText('First result')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'second' } });
    expect(screen.queryByText('First result')).not.toBeInTheDocument();
  });
});

describe('SearchBox results page entry', () => {
  beforeEach(() => {
    vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the results page on Enter when no row is highlighted', () => {
    const { props } = renderSearchBox();
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: '  hello  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onOpenResults).toHaveBeenCalledWith('hello');
  });

  it('reaches "see all results" by keyboard after the last row', () => {
    const track = { id: 't1', title: 'Hello', artist: 'A', album: 'B', duration: 1, audioUrl: '' };
    const { props } = renderSearchBox({ localTracks: [track] });
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onNavigateToTrack).not.toHaveBeenCalled();
    expect(props.onOpenResults).toHaveBeenCalledWith('hello');
  });

  it('navigates to a highlighted library row on Enter', () => {
    const track = { id: 't1', title: 'Hello', artist: 'A', album: 'B', duration: 1, audioUrl: '' };
    const { props } = renderSearchBox({ localTracks: [track] });
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onNavigateToTrack).toHaveBeenCalledWith(track);
    expect(props.onOpenResults).not.toHaveBeenCalled();
  });
});
