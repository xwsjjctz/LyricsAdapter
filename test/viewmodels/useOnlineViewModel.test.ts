import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { onlineSongToTrack } from '@/domain/trackFactory';
import { useOnlineViewModel, type OnlineViewModelOptions } from '@/viewmodels/useOnlineViewModel';
import type { Track } from '@/types';

function setup() {
  const options: OnlineViewModelOptions = {
    progress: {},
    playSong: vi.fn(),
    download: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
    navigateToTrack: vi.fn(),
  };
  const { result } = renderHook(() => useOnlineViewModel(options));
  return { options, vm: result.current };
}

describe('useOnlineViewModel.downloadTrack', () => {
  it('downloads an online track from its own provider', () => {
    const { options, vm } = setup();
    const track = onlineSongToTrack({ songmid: 'n1', songname: 'Song', singer: [{ name: 'A' }] }, 'netease');

    vm.downloadTrack(track, 'flac');

    expect(options.download).toHaveBeenCalledWith(
      expect.objectContaining({ songmid: 'n1', songname: 'Song' }),
      'flac',
      'netease',
    );
  });

  it('ignores tracks that are not from an online provider', () => {
    const { options, vm } = setup();
    const local: Track = { id: 'l1', title: 'A', artist: 'B', album: 'C', duration: 1, audioUrl: '', source: 'local' };

    vm.downloadTrack(local, '320');

    expect(options.download).not.toHaveBeenCalled();
  });
});
