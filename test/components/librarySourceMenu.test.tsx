import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlaylistInfo } from '@/services/onlineMusicProvider';

const playlists: PlaylistInfo[] = [
  { id: '1', name: 'Favourites', coverUrl: '', songCount: 651, source: 'qq' },
  { id: '2', name: 'Road trip', coverUrl: '', songCount: 20, source: 'netease' },
];

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import LibrarySourceMenu from '@/components/LibrarySourceMenu';

function setup(current: React.ComponentProps<typeof LibrarySourceMenu>['current'] = { kind: 'slot', slot: 'local' }) {
  const onSelectSlot = vi.fn();
  const onOpenPlaylist = vi.fn();
  const onOpen = vi.fn();
  render(<LibrarySourceMenu current={current} title="Local" counts={{ local: 118, online: 3 }} playlists={playlists}
    onOpen={onOpen} onSelectSlot={onSelectSlot} onOpenPlaylist={onOpenPlaylist} />);
  const trigger = screen.getByRole('button', { name: 'library.switchSource' });
  return { trigger, onSelectSlot, onOpenPlaylist, onOpen };
}

describe('LibrarySourceMenu', () => {
  it('lists local, online history and the given playlists at one level', async () => {
    const { trigger, onOpen } = setup();
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getAllByRole('menuitemradio')).toHaveLength(4));
    const names = screen.getAllByRole('menuitemradio').map(item => item.textContent);
    expect(names).toEqual(['hard_drivesidebar.local118', 'historysidebar.online3', 'queue_musicFavourites651', 'queue_musicRoad trip20']);
    expect(screen.getByRole('menuitemradio', { name: /sidebar.local/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('marks the open playlist and opens another one', async () => {
    const { trigger, onOpenPlaylist } = setup({ kind: 'playlist', source: 'qq', id: '1' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: /Favourites/ })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Road trip/ }));
    expect(onOpenPlaylist).toHaveBeenCalledWith(playlists[1]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('switches slots and supports arrow keys and Escape', async () => {
    const { trigger, onSelectSlot } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: /sidebar.local/ })).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: /sidebar.online/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /sidebar.online/ }));
    expect(onSelectSlot).toHaveBeenCalledWith('online');
  });
});
