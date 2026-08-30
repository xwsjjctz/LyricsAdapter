import { beforeEach, describe, expect, it, vi } from 'vitest';
import { splitGraphemes } from '@/shared/graphemes';
import {
  SYSTEM_LYRICS_WINDOW_GRAPHEMES,
  type SystemLyricsState,
} from '@/types/systemLyrics';

const controlImageMocks = vi.hoisted(() => ({
  create: vi.fn(),
  pauseImage: { kind: 'pause-control-image' },
  playImage: { kind: 'play-control-image' },
}));

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class MockTray {
    static instances: MockTray[] = [];

    readonly listeners = new Map<string, Listener[]>();
    destroyed = false;
    title = '';
    titleOptions: unknown;
    toolTip = 'not-cleared';
    contextMenu: unknown = 'not-cleared';
    ignoreDoubleClickEvents = false;
    image: unknown;

    readonly on = vi.fn((event: string, listener: Listener) => {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    });
    readonly setTitle = vi.fn((title: string, options?: unknown) => {
      this.title = title;
      this.titleOptions = options;
    });
    readonly setImage = vi.fn((image: unknown) => {
      this.image = image;
    });
    readonly setToolTip = vi.fn((toolTip: string) => {
      this.toolTip = toolTip;
    });
    readonly setContextMenu = vi.fn((menu: unknown) => {
      this.contextMenu = menu;
    });
    readonly setIgnoreDoubleClickEvents = vi.fn((ignore: boolean) => {
      this.ignoreDoubleClickEvents = ignore;
    });
    readonly getBounds = vi.fn(() => ({ x: 100, y: 0, width: 355, height: 24 }));
    readonly isDestroyed = vi.fn(() => this.destroyed);
    readonly destroy = vi.fn(() => {
      this.destroyed = true;
    });

    constructor(image: unknown) {
      this.image = image;
      MockTray.instances.push(this);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  return {
    MockTray,
    emptyImage: { kind: 'empty-image' },
    createEmpty: vi.fn(),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  Tray: electronMocks.MockTray,
  nativeImage: { createEmpty: electronMocks.createEmpty },
}));

vi.mock('@/../electron/services/menuBarControlImage', () => ({
  MENU_BAR_CONTROL_STRIP_WIDTH: 120,
  createMenuBarControlImage: controlImageMocks.create,
}));

vi.mock('@/../electron/logger', () => ({ logger: electronMocks.logger }));

import {
  MenuBarLyricsService,
  formatMenuBarControls,
  formatMenuBarLyricsTitle,
} from '@/../electron/services/menuBarLyricsService';

const IDEOGRAPHIC_SPACE = '\u3000';
const EVENT = {};
const BOUNDS = { x: 1_000, y: 0, width: 370, height: 24 };
const CONTROL_START_X = (BOUNDS.width - 120) / 2;

function state(overrides: Partial<SystemLyricsState> = {}): SystemLyricsState {
  return {
    trackId: 'track-1',
    title: '测试歌曲',
    artist: '测试歌手',
    line: '今天 天气真好',
    nextLine: '下一行',
    isPlaying: true,
    lineCursor: null,
    ...overrides,
  };
}

function point(x: number): { x: number; y: number } {
  return { x, y: 12 };
}

describe('MenuBarLyricsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.MockTray.instances.length = 0;
    electronMocks.createEmpty.mockReturnValue(electronMocks.emptyImage);
    controlImageMocks.create.mockImplementation((isPlaying: boolean) => (
      isPlaying ? controlImageMocks.pauseImage : controlImageMocks.playImage
    ));
  });

  it('does not create a status item outside macOS', () => {
    const service = new MenuBarLyricsService('win32');

    expect(service.start(vi.fn())).toBe(false);
    expect(electronMocks.createEmpty).not.toHaveBeenCalled();
    expect(electronMocks.MockTray.instances).toHaveLength(0);
  });

  it('starts one title-only status item with no context menu or tooltip', () => {
    const service = new MenuBarLyricsService('darwin');

    expect(service.start(vi.fn())).toBe(true);
    expect(service.start(vi.fn())).toBe(true);

    const tray = electronMocks.MockTray.instances[0]!;
    expect(electronMocks.createEmpty).toHaveBeenCalledOnce();
    expect(electronMocks.MockTray.instances).toHaveLength(1);
    expect(tray.image).toBe(electronMocks.emptyImage);
    expect(tray.setContextMenu).toHaveBeenCalledWith(null);
    expect(tray.setIgnoreDoubleClickEvents).toHaveBeenCalledOnce();
    expect(tray.setIgnoreDoubleClickEvents).toHaveBeenCalledWith(true);
    expect(tray.setToolTip).toHaveBeenCalledWith('');
    expect(tray.contextMenu).toBeNull();
    expect(tray.toolTip).toBe('');
    expect(tray.title).toBe(`LyricsAdapter${IDEOGRAPHIC_SPACE.repeat(11)}`);
    expect(tray.titleOptions).toEqual({ fontType: 'monospaced' });
    expect(tray.on.mock.calls.map(([event]) => event)).toEqual([
      'mouse-enter',
      'mouse-leave',
      'click',
    ]);
    expect(electronMocks.logger.info).toHaveBeenCalledWith(
      '[MenuBarLyrics] Status item ready:',
      expect.objectContaining({ mode: 'lyrics-with-native-controls' }),
    );
  });

  it('reports startup failure without retaining a broken tray', () => {
    electronMocks.createEmpty.mockImplementationOnce(() => {
      throw new Error('native failure');
    });
    const service = new MenuBarLyricsService('darwin');

    expect(service.start(vi.fn())).toBe(false);
    expect(electronMocks.MockTray.instances).toHaveLength(0);
    expect(electronMocks.logger.error).toHaveBeenCalledWith(
      '[MenuBarLyrics] Failed to start:',
      expect.any(Error),
    );
  });

  it('shows compact native controls on enter, updates play state, and restores lyrics on leave', () => {
    const service = new MenuBarLyricsService('darwin');
    service.start(vi.fn());
    service.update(state({ line: '我们还会再见' }));
    const tray = electronMocks.MockTray.instances[0]!;

    tray.emit('mouse-enter', EVENT, point(120));
    expect(controlImageMocks.create).toHaveBeenCalledWith(true, 355);
    expect(tray.image).toBe(controlImageMocks.pauseImage);
    expect(tray.title).toBe('');
    expect(tray.setImage.mock.invocationCallOrder.at(-1))
      .toBeLessThan(tray.setTitle.mock.invocationCallOrder.at(-1)!);

    service.update(state({ line: '不应在悬停时显示', isPlaying: false }));
    expect(controlImageMocks.create).toHaveBeenLastCalledWith(false, 355);
    expect(tray.image).toBe(controlImageMocks.playImage);
    expect(tray.title).toBe('');

    tray.emit('mouse-leave', EVENT, point(120));
    expect(tray.title).toBe(formatMenuBarLyricsTitle(state({
      line: '不应在悬停时显示',
      isPlaying: false,
    })));
    expect(tray.image).toBe(electronMocks.emptyImage);
    expect(tray.title).not.toContain('已暂停');
    expect(tray.setTitle.mock.invocationCallOrder.at(-1))
      .toBeLessThan(tray.setImage.mock.invocationCallOrder.at(-1)!);
  });

  it('routes compact fallback symbols and retries native controls on the next hover', () => {
    controlImageMocks.create.mockReturnValue(null);
    const onAction = vi.fn();
    const service = new MenuBarLyricsService('darwin');
    service.start(onAction);
    service.update(state());
    const tray = electronMocks.MockTray.instances[0]!;

    tray.emit('mouse-enter', EVENT, point(120));

    expect(tray.title).toBe(formatMenuBarControls(true));
    expect(tray.title).toContain('⏮︎');
    expect(tray.title).toContain('⏸︎');
    expect(tray.title).toContain('⏭︎');
    expect(tray.title).not.toMatch(/[\u4e00-\u9fff]/u);
    expect(electronMocks.logger.warn).toHaveBeenCalledOnce();

    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 20));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 60));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 100));
    expect(onAction.mock.calls).toEqual([
      ['previous'],
      ['toggle-play'],
      ['next'],
    ]);

    service.update(state({
      line: '同一次悬停切换播放状态也不应重试',
      isPlaying: false,
    }));
    expect(controlImageMocks.create).toHaveBeenCalledOnce();
    expect(tray.title).toBe(formatMenuBarControls(false));

    tray.emit('mouse-leave', EVENT, point(120));
    tray.emit('mouse-enter', EVENT, point(120));
    expect(controlImageMocks.create).toHaveBeenCalledTimes(2);
    expect(electronMocks.logger.warn).toHaveBeenCalledOnce();
  });

  it('pins one hover to fallback after a native image failure, including cached states', () => {
    controlImageMocks.create.mockImplementation((isPlaying: boolean) => (
      isPlaying ? controlImageMocks.pauseImage : null
    ));
    const service = new MenuBarLyricsService('darwin');
    service.start(vi.fn());
    service.update(state({ isPlaying: true }));
    const tray = electronMocks.MockTray.instances[0]!;

    tray.emit('mouse-enter', EVENT, point(120));
    expect(tray.image).toBe(controlImageMocks.pauseImage);

    service.update(state({ isPlaying: false }));
    expect(tray.title).toBe(formatMenuBarControls(false));
    expect(tray.image).toBe(electronMocks.emptyImage);

    service.update(state({ isPlaying: true }));
    expect(controlImageMocks.create).toHaveBeenCalledTimes(2);
    expect(tray.title).toBe(formatMenuBarControls(true));
    expect(tray.image).toBe(electronMocks.emptyImage);
  });

  it('routes the three hover regions and treats exact boundaries consistently', () => {
    const service = new MenuBarLyricsService('darwin');
    const onAction = vi.fn();
    service.start(onAction);
    const tray = electronMocks.MockTray.instances[0]!;

    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 10));
    expect(onAction).not.toHaveBeenCalled();

    tray.emit('mouse-enter', EVENT, point(110));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 39.999));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 40));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 79.999));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 80));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 119.999));

    expect(onAction.mock.calls).toEqual([
      ['previous'],
      ['previous'],
      ['toggle-play'],
      ['toggle-play'],
      ['next'],
      ['next'],
    ]);
  });

  it('ignores invalid or out-of-bounds click coordinates', () => {
    const service = new MenuBarLyricsService('darwin');
    const onAction = vi.fn();
    service.start(onAction);
    const tray = electronMocks.MockTray.instances[0]!;
    tray.emit('mouse-enter', EVENT, point(110));

    tray.emit('click', EVENT, BOUNDS, point(-1));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X - 0.001));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 120));
    tray.emit('click', EVENT, BOUNDS, point(BOUNDS.width + 1));
    tray.emit('click', EVENT, { ...BOUNDS, width: 0 }, point(0));
    tray.emit('click', EVENT, { ...BOUNDS, width: Number.NaN }, point(0));
    tray.emit('click', EVENT, BOUNDS, point(Number.NaN));

    expect(onAction).not.toHaveBeenCalled();
  });

  it('stops routing clicks after leave or destruction', () => {
    const service = new MenuBarLyricsService('darwin');
    const onAction = vi.fn();
    service.start(onAction);
    const tray = electronMocks.MockTray.instances[0]!;

    tray.emit('mouse-enter', EVENT, point(110));
    tray.emit('mouse-leave', EVENT, point(110));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 10));
    const titleUpdatesBeforeStop = tray.setTitle.mock.calls.length;
    service.stop();
    tray.emit('mouse-enter', EVENT, point(110));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 10));
    service.update(state({ line: '不应渲染' }));

    expect(onAction).not.toHaveBeenCalled();
    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(tray.setTitle).toHaveBeenCalledTimes(titleUpdatesBeforeStop);
  });

  it('replaces the action handler without duplicating native listeners', () => {
    const service = new MenuBarLyricsService('darwin');
    const firstHandler = vi.fn();
    const replacementHandler = vi.fn();
    service.start(firstHandler);
    service.start(replacementHandler);
    const tray = electronMocks.MockTray.instances[0]!;

    tray.emit('mouse-enter', EVENT, point(110));
    tray.emit('click', EVENT, BOUNDS, point(CONTROL_START_X + 60));

    expect(firstHandler).not.toHaveBeenCalled();
    expect(replacementHandler).toHaveBeenCalledOnce();
    expect(replacementHandler).toHaveBeenCalledWith('toggle-play');
    expect(tray.listeners.get('click')).toHaveLength(1);
  });
});

describe('menu-bar title formatting', () => {
  it('always renders exactly twenty-four graphemes and pads short lyrics with full-width spaces', () => {
    const title = formatMenuBarLyricsTitle(state({ line: '你好👩‍🎤' }));

    expect(splitGraphemes(title)).toHaveLength(SYSTEM_LYRICS_WINDOW_GRAPHEMES);
    expect(title.startsWith('你好👩‍🎤')).toBe(true);
    expect(title.endsWith(IDEOGRAPHIC_SPACE.repeat(21))).toBe(true);
  });

  it('does not add an icon or paused prefix to lyrics and title fallback', () => {
    const pausedLyric = formatMenuBarLyricsTitle(state({
      line: '我们还会再见',
      isPlaying: false,
    }));
    const titleFallback = formatMenuBarLyricsTitle(state({
      line: '',
      title: 'Starboy',
      isPlaying: false,
    }));

    expect(pausedLyric.startsWith('我们还会再见')).toBe(true);
    expect(pausedLyric).not.toContain('已暂停');
    expect(pausedLyric).not.toContain('♪');
    expect(titleFallback.startsWith('Starboy')).toBe(true);
    expect(titleFallback).not.toContain('♪');
  });

  it('scrolls a long line after the two-thirds cursor anchor without an ellipsis', () => {
    const graphemes = Array.from(
      { length: 34 },
      (_, index) => String.fromCodePoint(0x4e00 + index),
    );
    const line = graphemes.join('');

    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: null })))
      .toBe(graphemes.slice(0, 24).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 16 })))
      .toBe(graphemes.slice(0, 24).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 17 })))
      .toBe(graphemes.slice(1, 25).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 999 })))
      .toBe(graphemes.slice(-24).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 999 })))
      .not.toContain('…');

    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 12 }), 18))
      .toBe(graphemes.slice(0, 18).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 13 }), 18))
      .toBe(graphemes.slice(1, 19).join(''));
  });

  it('centers compact text fallback symbols without Chinese labels', () => {
    const playing = splitGraphemes(formatMenuBarControls(true));
    const paused = splitGraphemes(formatMenuBarControls(false));

    // Three extra full-width fallback slots ensure the narrower Unicode symbols
    // cannot contract a 24-CJK-character hover target.
    expect(playing).toHaveLength(SYSTEM_LYRICS_WINDOW_GRAPHEMES + 3);
    expect(paused).toHaveLength(SYSTEM_LYRICS_WINDOW_GRAPHEMES + 3);
    expect(playing.filter(value => value !== IDEOGRAPHIC_SPACE)).toEqual([
      '⏮︎', '⏸︎', '⏭︎',
    ]);
    expect(paused.filter(value => value !== IDEOGRAPHIC_SPACE)).toEqual([
      '⏮︎', '▶︎', '⏭︎',
    ]);
    expect(formatMenuBarControls(true)).not.toMatch(/[\u4e00-\u9fff]/u);
  });
});
