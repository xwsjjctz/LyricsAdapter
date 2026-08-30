import { beforeEach, describe, expect, it, vi } from 'vitest';
import { splitGraphemes } from '@/shared/graphemes';
import {
  SYSTEM_LYRICS_WINDOW_GRAPHEMES,
  type SystemLyricsState,
} from '@/types/systemLyrics';

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
    readonly setToolTip = vi.fn((toolTip: string) => {
      this.toolTip = toolTip;
    });
    readonly setContextMenu = vi.fn((menu: unknown) => {
      this.contextMenu = menu;
    });
    readonly setIgnoreDoubleClickEvents = vi.fn((ignore: boolean) => {
      this.ignoreDoubleClickEvents = ignore;
    });
    readonly getBounds = vi.fn(() => ({ x: 100, y: 0, width: 90, height: 24 }));
    readonly isDestroyed = vi.fn(() => this.destroyed);
    readonly destroy = vi.fn(() => {
      this.destroyed = true;
    });

    constructor(readonly image: unknown) {
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

vi.mock('@/../electron/logger', () => ({ logger: electronMocks.logger }));

import {
  MenuBarLyricsService,
  formatMenuBarControls,
  formatMenuBarLyricsTitle,
} from '@/../electron/services/menuBarLyricsService';

const IDEOGRAPHIC_SPACE = '\u3000';
const EVENT = {};
const BOUNDS = { x: 100, y: 0, width: 90, height: 24 };

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
    expect(tray.title).toBe(`LyricsAdapter${IDEOGRAPHIC_SPACE.repeat(5)}`);
    expect(tray.titleOptions).toEqual({ fontType: 'monospaced' });
    expect(tray.on.mock.calls.map(([event]) => event)).toEqual([
      'mouse-enter',
      'mouse-leave',
      'click',
    ]);
    expect(electronMocks.logger.info).toHaveBeenCalledWith(
      '[MenuBarLyrics] Status item ready:',
      expect.objectContaining({ mode: 'title-only' }),
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

  it('shows controls on enter, updates their play state, and restores lyrics on leave', () => {
    const service = new MenuBarLyricsService('darwin');
    service.start(vi.fn());
    service.update(state({ line: '我们还会再见' }));
    const tray = electronMocks.MockTray.instances[0]!;

    tray.emit('mouse-enter', EVENT, point(120));
    expect(tray.title).toBe(formatMenuBarControls(true));

    service.update(state({ line: '不应在悬停时显示', isPlaying: false }));
    expect(tray.title).toBe(formatMenuBarControls(false));
    expect(tray.title).toContain('播放');
    expect(tray.title).not.toContain('不应在悬停时显示');

    tray.emit('mouse-leave', EVENT, point(120));
    expect(tray.title).toBe(formatMenuBarLyricsTitle(state({
      line: '不应在悬停时显示',
      isPlaying: false,
    })));
    expect(tray.title).not.toContain('已暂停');
  });

  it('routes the three hover regions and treats exact boundaries consistently', () => {
    const service = new MenuBarLyricsService('darwin');
    const onAction = vi.fn();
    service.start(onAction);
    const tray = electronMocks.MockTray.instances[0]!;

    tray.emit('click', EVENT, BOUNDS, point(110));
    expect(onAction).not.toHaveBeenCalled();

    tray.emit('mouse-enter', EVENT, point(110));
    tray.emit('click', EVENT, BOUNDS, point(100));
    tray.emit('click', EVENT, BOUNDS, point(129.999));
    tray.emit('click', EVENT, BOUNDS, point(130));
    tray.emit('click', EVENT, BOUNDS, point(159.999));
    tray.emit('click', EVENT, BOUNDS, point(160));
    tray.emit('click', EVENT, BOUNDS, point(190));

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

    tray.emit('click', EVENT, BOUNDS, point(99));
    tray.emit('click', EVENT, BOUNDS, point(191));
    tray.emit('click', EVENT, { ...BOUNDS, width: 0 }, point(100));
    tray.emit('click', EVENT, { ...BOUNDS, width: Number.NaN }, point(100));
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
    tray.emit('click', EVENT, BOUNDS, point(110));
    const titleUpdatesBeforeStop = tray.setTitle.mock.calls.length;
    service.stop();
    tray.emit('mouse-enter', EVENT, point(110));
    tray.emit('click', EVENT, BOUNDS, point(110));
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
    tray.emit('click', EVENT, BOUNDS, point(145));

    expect(firstHandler).not.toHaveBeenCalled();
    expect(replacementHandler).toHaveBeenCalledOnce();
    expect(replacementHandler).toHaveBeenCalledWith('toggle-play');
    expect(tray.listeners.get('click')).toHaveLength(1);
  });
});

describe('menu-bar title formatting', () => {
  it('always renders exactly eighteen graphemes and pads short lyrics with full-width spaces', () => {
    const title = formatMenuBarLyricsTitle(state({ line: '你好👩‍🎤' }));

    expect(splitGraphemes(title)).toHaveLength(SYSTEM_LYRICS_WINDOW_GRAPHEMES);
    expect(title.startsWith('你好👩‍🎤')).toBe(true);
    expect(title.endsWith(IDEOGRAPHIC_SPACE.repeat(15))).toBe(true);
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

  it('scrolls a long line after cursor slot twelve without an ellipsis', () => {
    const graphemes = Array.from(
      { length: 26 },
      (_, index) => String.fromCodePoint(0x4e00 + index),
    );
    const line = graphemes.join('');

    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: null })))
      .toBe(graphemes.slice(0, 18).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 12 })))
      .toBe(graphemes.slice(0, 18).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 13 })))
      .toBe(graphemes.slice(1, 19).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 999 })))
      .toBe(graphemes.slice(-18).join(''));
    expect(formatMenuBarLyricsTitle(state({ line, lineCursor: 999 })))
      .not.toContain('…');
  });

  it('centers each hover label in one third of the fixed window', () => {
    const playing = splitGraphemes(formatMenuBarControls(true));
    const paused = splitGraphemes(formatMenuBarControls(false));

    expect(playing).toHaveLength(SYSTEM_LYRICS_WINDOW_GRAPHEMES);
    expect(playing.slice(0, 6).join('')).toBe(`${IDEOGRAPHIC_SPACE}上一首${IDEOGRAPHIC_SPACE.repeat(2)}`);
    expect(playing.slice(6, 12).join('')).toBe(`${IDEOGRAPHIC_SPACE.repeat(2)}暂停${IDEOGRAPHIC_SPACE.repeat(2)}`);
    expect(playing.slice(12).join('')).toBe(`${IDEOGRAPHIC_SPACE}下一首${IDEOGRAPHIC_SPACE.repeat(2)}`);
    expect(paused.slice(6, 12).join('')).toBe(`${IDEOGRAPHIC_SPACE.repeat(2)}播放${IDEOGRAPHIC_SPACE.repeat(2)}`);
  });
});
