import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { useLibraryController } from '@/controllers/useLibraryController';
import type { LibrarySlot, SlotId, Track } from '@/types';
import { libraryStorage } from '@/services/libraryStorage';
import { metadataCacheService } from '@/services/metadataCacheService';
import { coverArtService } from '@/services/coverArtService';
import { requestLibraryFlush } from '@/services/libraryFlushEvent';

vi.mock('@/services/desktopAdapter', () => ({ isDesktop: () => true }));
vi.mock('@/services/libraryStorage', () => ({ libraryStorage: { flushPendingSave: vi.fn(), saveLibrary: vi.fn() } }));
vi.mock('@/services/libraryFlushEvent', () => ({ requestLibraryFlush: vi.fn() }));
vi.mock('@/services/metadataCacheService', () => ({ metadataCacheService: { delete: vi.fn() } }));
vi.mock('@/services/coverArtService', () => ({ coverArtService: { deleteCover: vi.fn() } }));
function track(id: string): Track {
  return { id, title: id, artist: 'A', album: 'B', duration: 10, audioUrl: '', filePath: `/music/${id}.mp3` };
}
function slot(tracks: Track[], currentTrackIndex = -1, id: SlotId = 'local'): LibrarySlot {
  return { id, tracks, currentTrackIndex, currentTime: 12, volume: 0.7,
    playbackMode: 'order', scrollPosition: 0, filterType: 'default', categorySelection: null };
}
function setup(tracks: Track[], index = 0, activeSlotId: SlotId = 'local', cloudTracks: Track[] = []) {
  const slots = { local: slot(tracks, index), cloud: slot(cloudTracks, 0, 'cloud'),
    online: slot([], -1, 'online'), playlist: slot([], -1, 'playlist') };
  const slotsRef = { current: slots };
  const updateSlot = vi.fn((_id: SlotId, updater: (slot: LibrarySlot) => LibrarySlot) => {
    slotsRef.current = { ...slotsRef.current, [_id]: updater(slotsRef.current[_id]) };
  });
  const pause = vi.fn();
  const audioRef = { current: { pause, src: '' } } as unknown as MutableRefObject<HTMLAudioElement | null>;
  const setIsPlaying = vi.fn();
  const revokeBlobUrl = vi.fn();
  const { result } = renderHook(() => useLibraryController({
    viewSlot: 'local', activeSlotId, slots, slotsRef, updateSlot, updateLocalTracks: vi.fn(),
    getAppPersistenceData: () => ({}), audioRef, setIsPlaying, revokeBlobUrl,
  }));
  return { controller: result.current, slotsRef, updateSlot, pause, setIsPlaying, revokeBlobUrl };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(libraryStorage.flushPendingSave).mockResolvedValue(true);
  vi.mocked(requestLibraryFlush).mockResolvedValue(true);
});
describe('library removal', () => {
  it('persists removal, updates selection and clears unused application caches', async () => {
    const { controller, slotsRef, pause } = setup([track('a'), track('b')], 1);
    await controller.removeTrack('a');
    expect(slotsRef.current.local.tracks.map(t => t.id)).toEqual(['b']);
    expect(slotsRef.current.local.currentTrackIndex).toBe(0);
    expect(slotsRef.current.local.currentTime).toBe(12);
    expect(pause).not.toHaveBeenCalled();
    expect(libraryStorage.flushPendingSave).toHaveBeenCalledWith(expect.objectContaining({ songs: [expect.objectContaining({ id: 'b' })] }));
    expect(requestLibraryFlush).toHaveBeenCalled();
    expect(coverArtService.deleteCover).toHaveBeenCalledWith('a');
    expect(metadataCacheService.delete).toHaveBeenCalledWith('a');
    // The desktop mock deliberately exposes no file-deletion API.
  });
  it('pauses removal of the current track and selects its next surviving neighbour', async () => {
    const { controller, slotsRef, pause, setIsPlaying } = setup(['a', 'b', 'c', 'd'].map(track), 2);
    await controller.removeTracks(['a', 'c', 'c', 'missing']);
    expect(slotsRef.current.local.tracks.map(t => t.id)).toEqual(['b', 'd']);
    expect(slotsRef.current.local.currentTrackIndex).toBe(1);
    expect(slotsRef.current.local.currentTime).toBe(0);
    expect(pause).toHaveBeenCalledOnce();
    expect(setIsPlaying).toHaveBeenCalledWith(false);
  });
  it('does not pause the playing source when removing from another source', async () => {
    const { controller, slotsRef, pause } = setup([track('a')], 0, 'cloud');
    await controller.removeTrack('a');
    expect(slotsRef.current.local.currentTrackIndex).toBe(-1);
    expect(pause).not.toHaveBeenCalled();
  });
  it('keeps an unselected library unselected', async () => {
    const { controller, slotsRef } = setup(['a', 'b'].map(track), -1);
    await controller.removeTracks(['a']);
    expect(slotsRef.current.local.currentTrackIndex).toBe(-1);
  });
  it('retains caches and blob URLs still referenced by another slot', async () => {
    const shared = { ...track('a'), audioUrl: 'blob:shared', coverUrl: 'cover://a.png' };
    const { controller, revokeBlobUrl } = setup([shared], 0, 'cloud', [shared]);
    await controller.removeTrack('a');
    expect(coverArtService.deleteCover).not.toHaveBeenCalled();
    expect(metadataCacheService.delete).not.toHaveBeenCalled();
    expect(revokeBlobUrl).not.toHaveBeenCalled();
  });
  it('retains a shared cover even when track ids differ', async () => {
    const { controller } = setup([{ ...track('a'), coverUrl: 'cover://a.png?v=1' }], 0, 'cloud', [{ ...track('b'), coverUrl: 'cover://a.png?v=2' }]);
    await controller.removeTrack('a');
    expect(coverArtService.deleteCover).not.toHaveBeenCalled();
    expect(metadataCacheService.delete).toHaveBeenCalledWith('a');
  });
  it('leaves records and caches intact if saving fails', async () => {
    vi.mocked(libraryStorage.flushPendingSave).mockResolvedValue(false);
    const { controller, updateSlot, pause } = setup([track('a')]);
    await expect(controller.removeTrack('a')).rejects.toThrow('Could not save');
    expect(updateSlot).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(metadataCacheService.delete).not.toHaveBeenCalled();
  });
  it('retains caches when user-state persistence needs to retry', async () => {
    vi.mocked(requestLibraryFlush).mockResolvedValue(false);
    const { controller } = setup([track('a')]);
    await controller.removeTrack('a');
    expect(metadataCacheService.delete).not.toHaveBeenCalled();
  });
  it('does nothing for unknown ids or a cancelled reorder', async () => {
    const { controller, updateSlot } = setup([track('a')]);
    await controller.removeTrack('missing');
    await controller.reorderTracks(0, 0);
    expect(updateSlot).not.toHaveBeenCalled();
    expect(libraryStorage.flushPendingSave).not.toHaveBeenCalled();
  });
});
