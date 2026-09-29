import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from '@/components/palette/CommandPalette';
import type { PaletteLibrarySources } from '@/components/palette/usePaletteItems';
import type { PaletteCommand } from '@/commands/paletteCommand';
import { createCommandPaletteStore } from '@/hooks/useCommandPalette';
import { settingsManager } from '@/services/settingsManager';
import type { NativePaletteAction, NativePaletteState } from '@/types/nativePalette';
import type { Track } from '@/types';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), update: vi.fn(), stop: vi.fn(), onAction: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('@/services/desktopAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/desktopAdapter')>(),
  getDesktopAPI: () => ({ platform: 'darwin', ipc: { nativePalette: mocks } }),
}));

const track = (id: string, title: string): Track => ({
  id, title, artist: 'Artist', album: 'Album', duration: 180, audioUrl: '', lyrics: '',
} as Track);

function setup() {
  const store = createCommandPaletteStore();
  const runs = { settings: vi.fn() };
  const commands: PaletteCommand[] = [
    { id: 'source.local', title: 'Local library', icon: 'hard_drive', group: 'library', run: vi.fn() },
    { id: 'settings.open', title: 'Open settings', icon: 'settings', group: 'settings', run: runs.settings },
  ];
  const library: PaletteLibrarySources = {
    localTracks: [track('t1', 'Blue Moon'), track('t2', 'Yellow')],
    cloudTracks: [], playlists: [],
    playTrack: vi.fn(), playOnlineSong: vi.fn(), openPlaylist: vi.fn(), openAllResults: vi.fn(),
  };
  const view = render(<CommandPalette palette={store} commands={commands} library={library} />);
  const emit = (action: Partial<NativePaletteAction> & Pick<NativePaletteAction, 'type'>) =>
    act(() => (mocks.onAction.mock.calls[0]![0] as (a: NativePaletteAction) => void)({ value: 0, text: '', ...action }));
  const lastState = () => mocks.update.mock.calls.at(-1)![0] as NativePaletteState;
  return { store, runs, library, view, emit, lastState };
}

describe('CommandPalette on native macOS glass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(settingsManager, 'getQqMusicEnabled').mockReturnValue(false);
    mocks.start.mockResolvedValue({ ok: true, data: true });
    mocks.update.mockResolvedValue({ ok: true });
    mocks.stop.mockResolvedValue({ ok: true });
    mocks.onAction.mockReturnValue(mocks.unsubscribe);
  });

  it('renders only the dimming backdrop and pushes palette state to AppKit', async () => {
    const { store, view, lastState } = setup();
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(lastState().open).toBe(false);

    act(() => store.open());
    await waitFor(() => expect(lastState().open).toBe(true));
    expect(screen.queryByRole('combobox')).toBeNull();
    const backdrop = view.container.querySelector('.command-palette-backdrop');
    expect(backdrop).toHaveAttribute('data-controlbar-passthrough');
    expect(lastState().rows.map(row => row.title)).toEqual(['Local library']);
    expect(lastState().rows[0]!.symbol).toBe('internaldrive');
  });

  it('routes native typing, navigation and activation through palette intents', async () => {
    const { store, emit, lastState, library } = setup();
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    act(() => store.open());
    await waitFor(() => expect(lastState().open).toBe(true));

    emit({ type: 'query', text: 'e' });
    await waitFor(() => expect(lastState().query).toBe('e'));
    const titles = lastState().rows.map(row => row.title);
    expect(titles.slice(0, 2)).toEqual(['Blue Moon', 'Yellow']);

    emit({ type: 'move', value: 1 });
    await waitFor(() => expect(lastState().selected).toBe(1));
    emit({ type: 'activate', value: -1 });
    expect(library.playTrack).toHaveBeenCalledWith(library.localTracks[1]);
    expect(store.getState().open).toBe(false);
  });

  it('switches modes, runs a clicked row and closes on Escape', async () => {
    const { store, emit, lastState, runs } = setup();
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    act(() => store.open());
    // Tab in the native field switches modes, like Shift+Tab.
    emit({ type: 'tab' });
    expect(store.getState().mode).toBe('commands');
    emit({ type: 'cycle-mode' });
    expect(store.getState().mode).toBe('library');
    emit({ type: 'tab' });
    expect(store.getState().mode).toBe('commands');
    await waitFor(() => expect(lastState().modeIndex).toBe(1));
    emit({ type: 'mode', value: 1 });
    expect(store.getState().mode).toBe('commands');

    emit({ type: 'activate', value: 1 });
    expect(runs.settings).toHaveBeenCalledTimes(1);

    act(() => store.open());
    emit({ type: 'escape' });
    expect(store.getState().open).toBe(false);
  });

  it('replays forwarded Cmd shortcuts on window for global listeners', async () => {
    const { store, emit } = setup();
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    act(() => store.open());
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    emit({ type: 'shortcut', text: 'ArrowRight', value: 1 });
    window.removeEventListener('keydown', seen);
    expect(seen.mock.calls[0]![0]).toMatchObject({ key: 'ArrowRight', metaKey: true });
  });

  it('falls back to the web palette when AppKit rejects an update', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'surface lost' });
    const { store } = setup();
    await waitFor(() => expect(mocks.stop).toHaveBeenCalled());
    act(() => store.open());
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });
});
