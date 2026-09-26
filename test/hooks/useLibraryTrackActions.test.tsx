import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLibraryTrackActions } from '@/hooks/useLibraryTrackActions';
import type { Track } from '@/types';

const makeTrack = (id: string): Track => ({ id, title: id, artist: 'A', album: 'B', duration: 60, audioUrl: '' });
const tracks = [makeTrack('a'), makeTrack('b'), makeTrack('c')];

function setup(overrides: Partial<Parameters<typeof useLibraryTrackActions>[0]> = {}) {
  const onRemoveTrack = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
  const onRemoveMultipleTracks = vi.fn<(ids: string[]) => Promise<void>>().mockResolvedValue(undefined);
  const hook = renderHook(props => useLibraryTrackActions(props), {
    initialProps: {
      tracks, listedTracks: tracks, dataSource: 'local' as const, filterType: 'default' as const,
      categorySelection: null, onRemoveTrack, onRemoveMultipleTracks, ...overrides,
    },
  });
  return { ...hook, onRemoveTrack, onRemoveMultipleTracks };
}

describe('useLibraryTrackActions', () => {
  it('starts selection from the menu and batch-removes the selected tracks', async () => {
    const { result, onRemoveMultipleTracks } = setup();
    act(() => result.current.handleTrackMenuAction(tracks[0]!, 'select'));
    act(() => result.current.toggleSelectOne('c'));
    expect(result.current.isSelecting).toBe(true);
    expect([...result.current.selectedIds]).toEqual(['a', 'c']);

    act(() => result.current.requestBatchDelete());
    expect(result.current.deleteConfirm).toBe('batch');
    await act(() => result.current.confirmDelete());

    expect(onRemoveMultipleTracks).toHaveBeenCalledWith(['a', 'c']);
    expect(result.current.deleteConfirm).toBeNull();
    expect(result.current.isSelecting).toBe(false);
  });

  it('keeps the confirm open and reports failure when a single removal throws', async () => {
    const { result, onRemoveTrack } = setup();
    onRemoveTrack.mockRejectedValueOnce(new Error('disk'));
    act(() => result.current.handleTrackMenuAction(tracks[1]!, 'remove'));
    await act(() => result.current.confirmDelete());

    expect(onRemoveTrack).toHaveBeenCalledWith('b');
    expect(result.current.deleteConfirm).toBe('single');
    expect(result.current.removalError).toBe(true);
  });

  it('toggles select-all against the listed tracks and prunes ids that leave the list', () => {
    const { result, rerender } = setup();
    act(() => result.current.handleTrackMenuAction(tracks[0]!, 'select'));
    act(() => result.current.toggleSelectAll());
    expect(result.current.selectedIds.size).toBe(3);

    rerender({
      tracks, listedTracks: tracks.slice(0, 2), dataSource: 'local', filterType: 'default',
      categorySelection: null, onRemoveTrack: vi.fn(), onRemoveMultipleTracks: vi.fn(),
    });
    expect([...result.current.selectedIds]).toEqual(['a', 'b']);
  });
});
