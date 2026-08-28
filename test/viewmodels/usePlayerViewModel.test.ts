import { describe, expect, it, vi } from 'vitest';
import { usePlayerViewModel } from '../../src/viewmodels/usePlayerViewModel';

describe('usePlayerViewModel', () => {
  it('exposes the track-owned playback clock without leaking the audio element', () => {
    const getCurrentPlaybackTime = vi.fn(() => 0);
    const viewModel = usePlayerViewModel({
      currentTrack: null,
      isPlaying: false,
      currentTime: 7.75,
      volume: 0.5,
      playbackMode: 'order',
      getCurrentPlaybackTime,
      togglePlay: vi.fn(),
      skipForward: vi.fn(),
      skipBackward: vi.fn(),
      handleSeek: vi.fn(),
      handleVolumeChange: vi.fn(),
      handleToggleMute: vi.fn(),
      handleTogglePlaybackMode: vi.fn(),
    });

    expect(viewModel.getCurrentPlaybackTime()).toBe(0);
    expect(getCurrentPlaybackTime).toHaveBeenCalledOnce();
    expect(viewModel).not.toHaveProperty('audioRef');
  });
});
