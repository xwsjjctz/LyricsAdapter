import { describe, expect, it, vi } from 'vitest';
import type { SystemLyricsAction, SystemLyricsState } from '@/types/systemLyrics';

vi.mock('@/../electron/services/menuBarLyricsService', () => ({
  menuBarLyricsService: { start: vi.fn(), update: vi.fn(), stop: vi.fn() },
}));
vi.mock('@/../electron/services/windowsTaskbarLyricsService', () => ({
  windowsTaskbarLyricsService: { start: vi.fn(), update: vi.fn(), stop: vi.fn() },
}));

import {
  SystemLyricsCoordinator,
  type SystemLyricsPlatformService,
} from '@/../electron/services/systemLyricsCoordinator';

const PLAYING_STATE: SystemLyricsState = {
  trackId: 'track-1',
  title: 'Title',
  artist: 'Artist',
  line: 'Current line',
  nextLine: 'Next line',
  isPlaying: true,
};

function service(started = true): SystemLyricsPlatformService {
  return {
    start: vi.fn(() => started),
    update: vi.fn(),
    stop: vi.fn(),
  };
}

describe('SystemLyricsCoordinator', () => {
  it('initializes macOS eagerly and idempotently without restarting for updates', async () => {
    const macOS = service();
    const windows = service();
    const coordinator = new SystemLyricsCoordinator(vi.fn(), {
      platform: 'darwin', macOS, windows,
    });

    expect(coordinator.initialize()).toBe(true);
    expect(coordinator.initialize()).toBe(true);
    await coordinator.update({ ...PLAYING_STATE, trackId: null });
    await coordinator.update(PLAYING_STATE);
    await coordinator.update({ ...PLAYING_STATE, line: 'Another line' });

    expect(macOS.start).toHaveBeenCalledOnce();
    expect(macOS.update).toHaveBeenCalledTimes(3);
    expect(macOS.update).toHaveBeenNthCalledWith(1, {
      ...PLAYING_STATE,
      trackId: null,
    });
    expect(windows.start).not.toHaveBeenCalled();
  });

  it('keeps Windows initialization lazy until the first track arrives', async () => {
    const macOS = service();
    const windows = service();
    const coordinator = new SystemLyricsCoordinator(vi.fn(), {
      platform: 'win32', macOS, windows,
    });

    expect(coordinator.initialize()).toBe(false);
    await coordinator.update({ ...PLAYING_STATE, trackId: null });
    expect(windows.start).not.toHaveBeenCalled();
    expect(windows.update).not.toHaveBeenCalled();

    await coordinator.update(PLAYING_STATE);
    expect(windows.start).toHaveBeenCalledOnce();
    expect(windows.update).toHaveBeenCalledOnce();
    expect(macOS.start).not.toHaveBeenCalled();
  });

  it('forwards platform actions and stops the active service', async () => {
    const windows = service();
    const onAction = vi.fn();
    const coordinator = new SystemLyricsCoordinator(onAction, {
      platform: 'win32', macOS: service(), windows,
    });
    await coordinator.update(PLAYING_STATE);
    const actionHandler = vi.mocked(windows.start).mock.calls[0]?.[0] as (
      action: SystemLyricsAction,
    ) => void;

    actionHandler('next');
    coordinator.stop();

    expect(onAction).toHaveBeenCalledWith('next');
    expect(windows.stop).toHaveBeenCalledOnce();
  });

  it('does not retry a missing helper for every lyric line', async () => {
    const windows = service(false);
    const coordinator = new SystemLyricsCoordinator(vi.fn(), {
      platform: 'win32', macOS: service(), windows,
    });

    await coordinator.update(PLAYING_STATE);
    await coordinator.update({ ...PLAYING_STATE, line: 'Another line' });

    expect(windows.start).toHaveBeenCalledOnce();
    expect(windows.update).not.toHaveBeenCalled();
    expect(windows.stop).toHaveBeenCalledOnce();
  });

  it('retries a failed start when the track changes', async () => {
    const windows = service(false);
    vi.mocked(windows.start)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const coordinator = new SystemLyricsCoordinator(vi.fn(), {
      platform: 'win32', macOS: service(), windows,
    });

    await coordinator.update(PLAYING_STATE);
    await coordinator.update({ ...PLAYING_STATE, line: 'Another line' });
    const nextTrack = { ...PLAYING_STATE, trackId: 'track-2', title: 'Next track' };
    await coordinator.update(nextTrack);

    expect(windows.start).toHaveBeenCalledTimes(2);
    expect(windows.stop).toHaveBeenCalledOnce();
    expect(windows.update).toHaveBeenCalledOnce();
    expect(windows.update).toHaveBeenCalledWith(nextTrack);
  });

  it('rolls back a throwing start and always cleans the selected service on stop', async () => {
    const macOS = service();
    vi.mocked(macOS.start).mockImplementationOnce(() => {
      throw new Error('tray failed');
    });
    const coordinator = new SystemLyricsCoordinator(vi.fn(), {
      platform: 'darwin', macOS, windows: service(),
    });

    await expect(coordinator.update(PLAYING_STATE)).rejects.toThrow('tray failed');
    expect(macOS.stop).toHaveBeenCalledOnce();

    coordinator.stop();
    expect(macOS.stop).toHaveBeenCalledTimes(2);
  });

  it('is inert on unsupported platforms', async () => {
    const macOS = service();
    const windows = service();
    const coordinator = new SystemLyricsCoordinator(vi.fn(), {
      platform: 'linux', macOS, windows,
    });

    await expect(coordinator.update(PLAYING_STATE)).resolves.toBeUndefined();
    expect(macOS.start).not.toHaveBeenCalled();
    expect(windows.start).not.toHaveBeenCalled();
  });
});
