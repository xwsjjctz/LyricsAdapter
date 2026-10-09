import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlaylistSwitcher from '@/components/playlist-switcher/PlaylistSwitcher';
import { toNativeSwitcherState } from '@/components/playlist-switcher/nativeSwitcherState';
import type { PlaylistSwitchItem } from '@/components/playlist-switcher/types';
import { commandPalette } from '@/hooks/useCommandPalette';
import { shortcutManager } from '@/services/shortcuts';
import { PLAYLIST_SWITCHER_MAX_CARDS, type PlaylistSwitcherAction, type PlaylistSwitcherState } from '@/types/playlistSwitcher';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), update: vi.fn(), stop: vi.fn(), onAction: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('@/services/desktopAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/desktopAdapter')>(),
  getDesktopAPI: () => ({ platform: 'darwin', ipc: { playlistSwitcher: mocks } }),
}));

const cycle = (extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: '`', code: 'Backquote', metaKey: true, ...extra });
const release = () => fireEvent.keyUp(window, { key: 'Meta', metaKey: false });
const makeItems = (count: number): PlaylistSwitchItem[] => Array.from({ length: count }, (_, index) => ({
  id: `list-${index}`, name: `Playlist ${index}`, detail: '10 tracks', icon: index ? 'queue_music' : 'hard_drive',
  coverUrl: index === 1 ? 'cover://playlist/1' : undefined, run: vi.fn(),
}));
const lastState = () => mocks.update.mock.calls.at(-1)![0] as PlaylistSwitcherState;
const emit = (action: PlaylistSwitcherAction) =>
  act(() => (mocks.onAction.mock.calls[0]![0] as (a: PlaylistSwitcherAction) => void)(action));
/** Mounts the switcher and waits until AppKit has taken over the panel. */
async function setup(count = 3) {
  const items = makeItems(count);
  const view = render(<PlaylistSwitcher items={items} activeId={items[0]!.id} />);
  await waitFor(() => expect(mocks.update).toHaveBeenCalled());
  return { items, view };
}

beforeEach(() => {
  vi.clearAllMocks();
  shortcutManager.resetAllToDefaults();
  commandPalette.close();
  mocks.start.mockResolvedValue({ ok: true, data: true });
  mocks.update.mockResolvedValue({ ok: true });
  mocks.stop.mockResolvedValue({ ok: true });
  mocks.onAction.mockReturnValue(mocks.unsubscribe);
});
afterEach(cleanup);

describe('PlaylistSwitcher on native macOS glass', () => {
  it('renders only the dimming backdrop and pushes the frozen session to AppKit', async () => {
    const { view } = await setup();
    expect(lastState()).toMatchObject({ open: false, selected: -1, cards: [] });

    cycle();
    await waitFor(() => expect(lastState().open).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    const backdrop = view.container.querySelector('.playlist-switcher-backdrop');
    expect(backdrop).toHaveAttribute('data-controlbar-passthrough');
    expect(backdrop).toHaveFocus();
    // i18n is not initialised in unit tests, so strings arrive as their keys.
    expect(lastState()).toEqual({
      open: true, darkMode: true, label: 'playlistSwitcher.label', hint: 'playlistSwitcher.hint', selected: 1,
      cards: [
        { name: 'Playlist 0', detail: '10 tracks', symbol: 'internaldrive', cover: null },
        { name: 'Playlist 1', detail: '10 tracks', symbol: 'music.note.list', cover: 'cover://playlist/1?size=192' },
        { name: 'Playlist 2', detail: '10 tracks', symbol: 'music.note.list', cover: null },
      ],
    });
  });

  it('keeps the keyboard gesture in the page while AppKit draws the panel', async () => {
    const { items } = await setup();
    cycle();
    await waitFor(() => expect(lastState().selected).toBe(1));
    cycle();
    await waitFor(() => expect(lastState().selected).toBe(2));
    cycle({ shiftKey: true });
    await waitFor(() => expect(lastState().selected).toBe(1));
    release();
    expect(items[1]!.run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(lastState().open).toBe(false));
  });

  it('previews a hovered card and opens a clicked one', async () => {
    const { items } = await setup();
    cycle();
    await waitFor(() => expect(lastState().open).toBe(true));
    emit({ type: 'hover', value: 2 });
    await waitFor(() => expect(lastState().selected).toBe(2));
    for (const item of items) expect(item.run).not.toHaveBeenCalled();
    // An index outside the session is ignored rather than opening anything.
    emit({ type: 'activate', value: 9 });
    expect(lastState().open).toBe(true);

    emit({ type: 'activate', value: 0 });
    expect(items[0]!.run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(lastState().open).toBe(false));
    release();
    expect(items[0]!.run).toHaveBeenCalledTimes(1);
  });

  it('cancels from the backdrop or Escape without opening a list', async () => {
    const { items, view } = await setup();
    cycle();
    await waitFor(() => expect(lastState().open).toBe(true));
    fireEvent.mouseDown(view.container.querySelector('.playlist-switcher-backdrop')!);
    await waitFor(() => expect(lastState().open).toBe(false));
    release();
    cycle();
    await waitFor(() => expect(lastState().open).toBe(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(lastState().open).toBe(false));
    release();
    for (const item of items) expect(item.run).not.toHaveBeenCalled();
    expect(view.container.querySelector('.playlist-switcher-backdrop')).toBeNull();
  });

  it('falls back to the web panel when AppKit rejects an update', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'surface lost' });
    render(<PlaylistSwitcher items={makeItems(3)} activeId="list-0" />);
    await waitFor(() => expect(mocks.stop).toHaveBeenCalled());
    cycle();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('option', { selected: true })).toHaveAccessibleName('Playlist 1');
  });

  it('keeps a session the native surface cannot hold on the web panel', async () => {
    await setup(PLAYLIST_SWITCHER_MAX_CARDS + 1);
    cycle();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(PLAYLIST_SWITCHER_MAX_CARDS + 1);
    expect(lastState().open).toBe(false);
    release();
  });
});

describe('native switcher state', () => {
  const session = (items: PlaylistSwitchItem[], selectedId: string) => ({ items, selectedId, modifier: null });
  const base = { darkMode: true, label: 'Switch playlists', hint: 'hint' };

  it('passes only covers the main process can fetch and clips long text', () => {
    const items: PlaylistSwitchItem[] = [
      { id: 'a', name: 'n'.repeat(3000), detail: '', icon: 'unknown_icon', coverUrl: 'https://example.com/a.jpg', run: vi.fn() },
      { id: 'b', name: 'B', detail: '', icon: 'cloud', coverUrl: `data:image/png;base64,${'a'.repeat(9000)}`, run: vi.fn() },
    ];
    const state = toNativeSwitcherState({ ...base, session: session(items, 'b'), hint: 'h'.repeat(400) });
    expect(state.selected).toBe(1);
    expect(state.hint).toHaveLength(256);
    expect(state.cards[0]).toMatchObject({ symbol: 'circle.dashed', cover: 'https://example.com/a.jpg' });
    expect(state.cards[0]!.name).toHaveLength(2048);
    expect(state.cards[1]).toMatchObject({ symbol: 'cloud', cover: null });
  });

  it('reports closed without a session or when the selection left the list', () => {
    expect(toNativeSwitcherState({ ...base, session: null })).toEqual({
      open: false, darkMode: true, label: 'Switch playlists', hint: '', selected: -1, cards: [],
    });
    expect(toNativeSwitcherState({ ...base, session: session(makeItems(2), 'gone') }).open).toBe(false);
  });
});
