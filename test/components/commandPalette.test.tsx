import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from '@/components/palette/CommandPalette';
import type { PaletteLibrarySources } from '@/components/palette/usePaletteItems';
import type { PaletteCommand } from '@/commands/paletteCommand';
import { createCommandPaletteStore, type CommandPaletteStore } from '@/hooks/useCommandPalette';
import { settingsManager } from '@/services/settingsManager';
import type { Track } from '@/types';

const track = (id: string, title: string): Track => ({
  id, title, artist: 'Artist', album: 'Album', duration: 180, audioUrl: '', lyrics: '',
} as Track);

function setup() {
  const store: CommandPaletteStore = createCommandPaletteStore();
  const runs = { mute: vi.fn(), settings: vi.fn(), english: vi.fn(), local: vi.fn() };
  const commands: PaletteCommand[] = [
    { id: 'source.local', title: 'Local library', icon: 'hard_drive', group: 'library', run: runs.local },
    { id: 'playback.mute', title: 'Mute', icon: 'volume_off', group: 'playback', keepOpen: true, run: runs.mute },
    { id: 'settings.open', title: 'Open settings', icon: 'settings', group: 'settings', run: runs.settings },
    {
      id: 'appearance.language', title: 'Language', icon: 'translate', group: 'appearance',
      children: () => [{ id: 'appearance.language.en', title: 'English', icon: 'translate', group: 'appearance', run: runs.english }],
    },
  ];
  const library: PaletteLibrarySources = {
    localTracks: [track('t1', 'Blue Moon'), track('t2', 'Yellow')],
    cloudTracks: [],
    playlists: [{ id: 'p1', name: 'Road Trip', coverUrl: '', songCount: 9, source: 'netease' }],
    playTrack: vi.fn(),
    playOnlineSong: vi.fn(),
    openPlaylist: vi.fn(),
    openAllResults: vi.fn(),
  };
  render(<CommandPalette palette={store} commands={commands} library={library} />);
  act(() => store.open());
  const input = () => screen.getByRole('combobox');
  const press = (key: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input(), { key, ...init });
  const type = (value: string) => fireEvent.change(input(), { target: { value } });
  const titles = () => screen.queryAllByRole('option').map(option => option.querySelector('.command-palette__title')?.textContent);
  return { store, runs, library, press, type, titles };
}

describe('CommandPalette', () => {
  beforeEach(() => { vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(false); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('starts in library mode with sources and playlists, then searches tracks', () => {
    const { titles, type, press, library, store } = setup();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('palette.mode.library');
    expect(titles()).toEqual(['Local library', 'Road Trip']);

    type('moon');
    expect(titles()[0]).toBe('Blue Moon');
    press('Enter');
    expect(library.playTrack).toHaveBeenCalledWith(library.localTracks[0]);
    expect(store.getState().open).toBe(false);
  });

  it('switches to feature mode with Shift+Tab and runs commands', () => {
    const { press, type, runs, store, titles } = setup();
    press('Tab', { shiftKey: true });
    expect(store.getState().mode).toBe('commands');
    expect(titles()).toEqual(['Local library', 'Mute', 'Open settings', 'Language']);

    type('mute');
    press('Enter');
    expect(runs.mute).toHaveBeenCalledTimes(1);
    expect(store.getState().open).toBe(true);

    type('sett');
    press('Enter');
    expect(runs.settings).toHaveBeenCalledTimes(1);
    expect(store.getState().open).toBe(false);
  });

  it('enters nested lists with Tab and backs out with Escape', () => {
    const { press, store, titles, runs } = setup();
    act(() => store.cycleMode());
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    press('Tab');
    expect(store.getState().stack).toEqual(['appearance.language']);
    expect(titles()).toEqual(['English']);
    expect(screen.getByText('Language ›')).toBeInTheDocument();

    press('Escape');
    expect(store.getState()).toMatchObject({ open: true, stack: [] });
    press('Tab');
    press('Enter');
    expect(runs.local).toHaveBeenCalled();
  });

  it('keeps typing and handled keys away from global shortcuts', () => {
    const { press } = setup();
    const globalListener = vi.fn();
    window.addEventListener('keydown', globalListener);
    press(' ');
    press('ArrowDown');
    press('Tab', { shiftKey: true });
    press('k', { metaKey: true });
    window.removeEventListener('keydown', globalListener);
    expect(globalListener.mock.calls.map(([event]) => (event as KeyboardEvent).key)).toEqual(['k']);
  });

  it('closes on Escape with an empty query and on backdrop click', () => {
    const { press, store, type } = setup();
    type('x');
    press('Escape');
    expect(store.getState()).toMatchObject({ open: true, query: '' });
    press('Escape');
    expect(store.getState().open).toBe(false);

    act(() => store.open());
    fireEvent.mouseDown(document.querySelector('.command-palette-backdrop')!);
    expect(store.getState().open).toBe(false);
  });
});
