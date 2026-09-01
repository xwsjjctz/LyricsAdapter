import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  LaunchWindowsTaskbarHostOptions,
  WindowsTaskbarHostBridge,
} from '@/../electron/native/windowsTaskbarHost';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/../electron/logger', () => ({ logger: loggerMocks }));
vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => 'C:\\LyricsAdapter'),
    getPath: vi.fn(() => 'C:\\UserData'),
    isPackaged: false,
  },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}));

import {
  WindowsTaskbarLyricsService,
  type WindowsTaskbarLyricsServiceDependencies,
} from '@/../electron/services/windowsTaskbarLyricsService';

const PLAYING_STATE = {
  trackId: 'track-1',
  title: '测试歌曲',
  artist: '测试歌手',
  coverUrl: 'cover://track-1.jpg',
  line: '当前歌词',
  lineCursor: 7,
  lineProgress: 6,
  nextLine: '下一行',
  isPlaying: true,
};

class FakeHost implements WindowsTaskbarHostBridge {
  readonly update = vi.fn();
  readonly setVisible = vi.fn();
  readonly refresh = vi.fn();
  readonly stop = vi.fn();
}

interface TestSubscriptions {
  lock?: () => void;
  unlock?: () => void;
  disposeSession: ReturnType<typeof vi.fn>;
}

function createHarness(
  hosts: FakeHost[] = [new FakeHost()],
  overrides: Partial<WindowsTaskbarLyricsServiceDependencies> = {},
) {
  let hostIndex = 0;
  const callbacks: LaunchWindowsTaskbarHostOptions['callbacks'][] = [];
  const subscriptions: TestSubscriptions = {
    disposeSession: vi.fn(),
  };
  const hostExists = vi.fn(() => true);
  const launchHost = vi.fn((options: LaunchWindowsTaskbarHostOptions) => {
    callbacks.push(options.callbacks);
    return hosts[hostIndex++]!;
  });
  const resolveArtworkSource = vi.fn(() => 'file:///C:/UserData/covers/track-1.jpg');
  const dependencies: WindowsTaskbarLyricsServiceDependencies = {
    platform: 'win32',
    hostExecutablePath: 'C:\\LyricsAdapter\\native\\LyricsAdapter.TaskbarHost.exe',
    hostExists,
    launchHost,
    resolveArtworkSource,
    subscribeSessionChanges: (onLock, onUnlock) => {
      subscriptions.lock = onLock;
      subscriptions.unlock = onUnlock;
      return subscriptions.disposeSession;
    },
    ...overrides,
  };

  return {
    service: new WindowsTaskbarLyricsService(dependencies),
    hosts,
    callbacks,
    subscriptions,
    hostExists,
    launchHost,
    resolveArtworkSource,
  };
}

describe('WindowsTaskbarLyricsService', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('does not inspect or launch the Windows host on other platforms', () => {
    const harness = createHarness([new FakeHost()], { platform: 'darwin' });

    expect(harness.service.start(vi.fn())).toBe(false);
    harness.service.update(PLAYING_STATE);

    expect(harness.hostExists).not.toHaveBeenCalled();
    expect(harness.launchHost).not.toHaveBeenCalled();
    expect(harness.subscriptions.lock).toBeUndefined();
  });

  it('refuses to start when the packaged C# host is missing', () => {
    const hostExists = vi.fn(() => false);
    const harness = createHarness([new FakeHost()], { hostExists });

    expect(harness.service.start(vi.fn())).toBe(false);

    expect(harness.launchHost).not.toHaveBeenCalled();
    expect(loggerMocks.error).toHaveBeenCalledWith(
      '[WindowsTaskbarLyrics] C# taskbar host is unavailable:',
      'C:\\LyricsAdapter\\native\\LyricsAdapter.TaskbarHost.exe',
    );
  });

  it('launches lazily and forwards complete lyric, karaoke, artwork, and playback state', () => {
    const harness = createHarness();
    const host = harness.hosts[0]!;

    expect(harness.service.start(vi.fn())).toBe(true);
    expect(harness.launchHost).not.toHaveBeenCalled();
    harness.service.update(PLAYING_STATE);

    expect(harness.launchHost).toHaveBeenCalledOnce();
    expect(host.update).toHaveBeenCalledWith({
      artworkSource: 'file:///C:/UserData/covers/track-1.jpg',
      title: '测试歌曲',
      artist: '测试歌手',
      line: '当前歌词',
      nextLine: '下一行',
      lineCursor: 7,
      lineProgress: 6,
      isPlaying: true,
    });
    expect(harness.resolveArtworkSource).toHaveBeenCalledOnce();

    harness.service.update({ ...PLAYING_STATE, line: '同封面的下一帧', lineProgress: 8 });
    expect(harness.resolveArtworkSource).toHaveBeenCalledOnce();
    expect(host.update).toHaveBeenLastCalledWith(expect.objectContaining({
      line: '同封面的下一帧',
      lineProgress: 8,
    }));
  });

  it('routes native controls back through the existing player action callback', async () => {
    const onAction = vi.fn(async () => {});
    const harness = createHarness();
    harness.service.start(onAction);
    harness.service.update(PLAYING_STATE);

    harness.callbacks[0]!.onAction('previous');
    harness.callbacks[0]!.onAction('toggle-play');
    harness.callbacks[0]!.onAction('next');
    await Promise.resolve();

    expect(onAction.mock.calls).toEqual([
      ['previous'],
      ['toggle-play'],
      ['next'],
    ]);
  });

  it('hides while locked or empty and refreshes with the latest state after unlock', () => {
    const harness = createHarness();
    const host = harness.hosts[0]!;
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);

    harness.subscriptions.lock?.();
    expect(host.setVisible).toHaveBeenLastCalledWith(false);

    harness.service.update({ ...PLAYING_STATE, line: '锁屏期间的新歌词' });
    expect(host.update).toHaveBeenCalledTimes(1);

    harness.subscriptions.unlock?.();
    expect(host.refresh).toHaveBeenCalledOnce();
    expect(host.update).toHaveBeenLastCalledWith(expect.objectContaining({
      line: '锁屏期间的新歌词',
    }));

    harness.service.update({ ...PLAYING_STATE, trackId: null });
    expect(host.setVisible).toHaveBeenLastCalledWith(false);
  });

  it('restarts the host with backoff after an unexpected exit', () => {
    vi.useFakeTimers();
    const harness = createHarness([new FakeHost(), new FakeHost()]);
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);

    harness.callbacks[0]!.onExit(1, null);
    vi.advanceTimersByTime(499);
    expect(harness.launchHost).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);

    expect(harness.launchHost).toHaveBeenCalledTimes(2);
    expect(harness.hosts[1]!.update).toHaveBeenCalledWith(expect.objectContaining({
      line: '当前歌词',
    }));
  });

  it('recovers on unlock when the host exited while the session was locked', () => {
    vi.useFakeTimers();
    const harness = createHarness([new FakeHost(), new FakeHost()]);
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);

    harness.subscriptions.lock?.();
    harness.callbacks[0]!.onExit(1, null);
    vi.advanceTimersByTime(500);
    expect(harness.launchHost).toHaveBeenCalledOnce();

    harness.subscriptions.unlock?.();
    expect(harness.launchHost).toHaveBeenCalledTimes(2);
    expect(harness.hosts[1]!.refresh).toHaveBeenCalledOnce();
    expect(harness.hosts[1]!.update).toHaveBeenCalledWith(expect.objectContaining({
      line: '当前歌词',
    }));
  });

  it('does not carry a stale restart delay into the next track', () => {
    vi.useFakeTimers();
    const harness = createHarness([new FakeHost(), new FakeHost()]);
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);

    harness.callbacks[0]!.onExit(1, null);
    harness.service.update({ ...PLAYING_STATE, trackId: null });
    harness.service.update({ ...PLAYING_STATE, trackId: 'track-2' });

    expect(harness.launchHost).toHaveBeenCalledTimes(2);
    expect(harness.hosts[1]!.update).toHaveBeenCalledWith(expect.objectContaining({
      line: '当前歌词',
    }));
  });

  it('stops the host and removes the session subscription', () => {
    const harness = createHarness();
    const host = harness.hosts[0]!;
    harness.service.start(vi.fn());
    harness.service.update(PLAYING_STATE);
    harness.service.stop();

    expect(host.setVisible).toHaveBeenLastCalledWith(false);
    expect(host.stop).toHaveBeenCalledOnce();
    expect(harness.subscriptions.disposeSession).toHaveBeenCalledOnce();

    harness.callbacks[0]!.onExit(0, null);
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      '[WindowsTaskbarLyrics] C# taskbar host exited:',
      expect.anything(),
    );
  });
});
