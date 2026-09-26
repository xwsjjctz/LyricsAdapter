import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlaylistInfo } from '@/services/onlineMusicProvider';

const playlists: PlaylistInfo[] = [
  { id: '1', name: 'Favourites', coverUrl: 'https://a/1.jpg', songCount: 651, source: 'qq' },
  { id: '2', name: 'Hidden', coverUrl: '', songCount: 5, source: 'netease' },
];
const overrides = vi.hoisted(() => ({ map: { 'netease:2': { hidden: true } } as Record<string, { hidden?: boolean; name?: string }> }));

vi.mock('@/hooks/useOnlinePlaylists', () => ({ useOnlinePlaylists: () => ({ playlists, loading: false }) }));
vi.mock('@/services/playlistOverrides', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/playlistOverrides')>()),
  loadOverrides: vi.fn(async () => overrides.map),
}));

import { useVisiblePlaylists } from '@/hooks/useVisiblePlaylists';

describe('useVisiblePlaylists', () => {
  it('drops hidden playlists and applies renames', async () => {
    overrides.map = { 'netease:2': { hidden: true }, 'qq:1': { name: 'Loved' } };
    const { result } = renderHook(() => useVisiblePlaylists());
    await waitFor(() => expect(result.current.playlists.map(p => p.name)).toEqual(['Loved']));
  });

  it('re-reads overrides on refresh', async () => {
    overrides.map = { 'netease:2': { hidden: true } };
    const { result } = renderHook(() => useVisiblePlaylists());
    await waitFor(() => expect(result.current.playlists).toHaveLength(1));
    overrides.map = {};
    await act(() => result.current.refresh());
    expect(result.current.playlists).toHaveLength(2);
  });
});
