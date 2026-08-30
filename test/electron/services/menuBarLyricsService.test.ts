import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  class MockNativeImage {
    readonly setTemplateImage = vi.fn();
    readonly isEmpty = vi.fn(() => this.empty);
    readonly resize = vi.fn((): MockNativeImage => this);

    constructor(
      readonly source: string,
      private readonly empty = false,
    ) {}
  }

  class MockTray {
    static instances: MockTray[] = [];

    readonly image: unknown;
    destroyed = false;
    title = '';
    toolTip = '';
    contextMenu: { template: Array<Record<string, unknown>> } | null = null;
    setTitle = vi.fn((title: string) => { this.title = title; });
    setToolTip = vi.fn((toolTip: string) => { this.toolTip = toolTip; });
    setContextMenu = vi.fn((menu: { template: Array<Record<string, unknown>> }) => {
      this.contextMenu = menu;
    });
    getBounds = vi.fn(() => ({ x: 0, y: 0, width: 120, height: 24 }));
    isDestroyed = vi.fn(() => this.destroyed);
    destroy = vi.fn(() => { this.destroyed = true; });

    constructor(image: unknown) {
      this.image = image;
      MockTray.instances.push(this);
    }
  }

  return {
    MockNativeImage,
    MockTray,
    app: {
      isPackaged: false,
      getAppPath: vi.fn(() => '/workspace/LyricsAdapter'),
    },
    createFromNamedImage: vi.fn(),
    createFromPath: vi.fn(),
    createEmpty: vi.fn(),
    buildFromTemplate: vi.fn((template: Array<Record<string, unknown>>) => ({ template })),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  app: electronMocks.app,
  Tray: electronMocks.MockTray,
  nativeImage: {
    createFromNamedImage: electronMocks.createFromNamedImage,
    createFromPath: electronMocks.createFromPath,
    createEmpty: electronMocks.createEmpty,
  },
  Menu: { buildFromTemplate: electronMocks.buildFromTemplate },
}));

vi.mock('@/../electron/logger', () => ({ logger: electronMocks.logger }));

import {
  MenuBarLyricsService,
  formatMenuBarLyricsTitle,
  truncateMenuBarText,
} from '@/../electron/services/menuBarLyricsService';

describe('MenuBarLyricsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.MockTray.instances.length = 0;
    electronMocks.app.isPackaged = false;
    electronMocks.app.getAppPath.mockReturnValue('/workspace/LyricsAdapter');
    electronMocks.createFromNamedImage.mockReturnValue(
      new electronMocks.MockNativeImage('system-symbol'),
    );
    electronMocks.createFromPath.mockReturnValue(
      new electronMocks.MockNativeImage('application-icon'),
    );
    electronMocks.createEmpty.mockReturnValue(
      new electronMocks.MockNativeImage('title-only', true),
    );
  });

  it('does not create a tray outside macOS', () => {
    const service = new MenuBarLyricsService('win32');

    expect(service.start(vi.fn())).toBe(false);
    expect(electronMocks.createFromNamedImage).not.toHaveBeenCalled();
    expect(electronMocks.createFromPath).not.toHaveBeenCalled();
    expect(electronMocks.createEmpty).not.toHaveBeenCalled();
    expect(electronMocks.MockTray.instances).toHaveLength(0);
  });

  it('starts with the macOS music-note system symbol and remains idempotent', () => {
    const service = new MenuBarLyricsService('darwin');
    const firstActionHandler = vi.fn();
    const replacementActionHandler = vi.fn();

    expect(service.start(firstActionHandler)).toBe(true);
    expect(service.start(replacementActionHandler)).toBe(true);

    const tray = electronMocks.MockTray.instances[0]!;
    const systemSymbol = vi.mocked(electronMocks.createFromNamedImage).mock.results[0]!
      .value as InstanceType<typeof electronMocks.MockNativeImage>;
    expect(electronMocks.MockTray.instances).toHaveLength(1);
    expect(electronMocks.createFromNamedImage).toHaveBeenCalledOnce();
    expect(electronMocks.createFromNamedImage).toHaveBeenCalledWith('music.note');
    expect(systemSymbol.setTemplateImage).toHaveBeenCalledWith(true);
    expect(electronMocks.createFromPath).not.toHaveBeenCalled();
    expect(electronMocks.createEmpty).not.toHaveBeenCalled();
    expect(tray.image).toBe(systemSymbol);
    expect(tray.title).toBe('LyricsAdapter');
    expect(tray.toolTip).toBe('LyricsAdapter');
    expect(electronMocks.logger.info).toHaveBeenCalledWith(
      '[MenuBarLyrics] Status item ready:',
      expect.objectContaining({ iconSource: 'system-symbol' }),
    );

    const toggleItem = tray.contextMenu?.template[0];
    expect(toggleItem?.['label']).toBe('播放');
    (toggleItem?.['click'] as (() => void))();
    expect(firstActionHandler).not.toHaveBeenCalled();
    expect(replacementActionHandler).toHaveBeenCalledWith('toggle-play');
  });

  it('falls back to a resized application icon when the system symbol is empty', () => {
    const emptySymbol = new electronMocks.MockNativeImage('empty-symbol', true);
    const applicationIcon = new electronMocks.MockNativeImage('application-icon');
    const resizedIcon = new electronMocks.MockNativeImage('resized-application-icon');
    electronMocks.createFromNamedImage.mockReturnValue(emptySymbol);
    electronMocks.createFromPath.mockReturnValue(applicationIcon);
    applicationIcon.resize.mockReturnValue(resizedIcon);

    const service = new MenuBarLyricsService('darwin');

    expect(service.start(vi.fn())).toBe(true);
    expect(electronMocks.createFromPath).toHaveBeenCalledWith(
      '/workspace/LyricsAdapter/app-icon.png',
    );
    expect(applicationIcon.resize).toHaveBeenCalledWith({
      width: 16,
      height: 16,
      quality: 'best',
    });
    expect(electronMocks.MockTray.instances[0]?.image).toBe(resizedIcon);
    expect(electronMocks.createEmpty).not.toHaveBeenCalled();
    expect(electronMocks.logger.info).toHaveBeenCalledWith(
      '[MenuBarLyrics] Status item ready:',
      expect.objectContaining({ iconSource: 'application-icon' }),
    );
  });

  it('retains title-only lyrics when neither visible icon can be decoded', () => {
    const emptySymbol = new electronMocks.MockNativeImage('empty-symbol', true);
    const emptyApplicationIcon = new electronMocks.MockNativeImage('empty-application-icon', true);
    const titleOnlyImage = new electronMocks.MockNativeImage('title-only', true);
    electronMocks.createFromNamedImage.mockReturnValue(emptySymbol);
    electronMocks.createFromPath.mockReturnValue(emptyApplicationIcon);
    electronMocks.createEmpty.mockReturnValue(titleOnlyImage);

    const service = new MenuBarLyricsService('darwin');

    expect(service.start(vi.fn())).toBe(true);
    expect(titleOnlyImage.setTemplateImage).toHaveBeenCalledWith(true);
    expect(electronMocks.MockTray.instances[0]?.image).toBe(titleOnlyImage);
    expect(electronMocks.logger.info).toHaveBeenCalledWith(
      '[MenuBarLyrics] Status item ready:',
      expect.objectContaining({ iconSource: 'title-only' }),
    );
  });

  it('normalizes and renders the current lyric without rebuilding a stable menu', () => {
    const service = new MenuBarLyricsService('darwin');
    service.start(vi.fn());
    const tray = electronMocks.MockTray.instances[0]!;
    electronMocks.buildFromTemplate.mockClear();

    service.update({
      trackId: 'track-1',
      line: '  今天\n  天气\t真好  ',
      nextLine: '下一行',
      title: '测试歌曲',
      artist: '测试歌手',
      isPlaying: true,
    });
    service.update({
      trackId: 'track-1',
      line: '下一行',
      nextLine: '',
      title: '测试歌曲',
      artist: '测试歌手',
      isPlaying: true,
    });

    expect(tray.setTitle).toHaveBeenNthCalledWith(2, '今天 天气 真好');
    expect(tray.title).toBe('下一行');
    expect(tray.toolTip).toBe('LyricsAdapter — 正在播放：测试歌曲 — 测试歌手');
    expect(electronMocks.buildFromTemplate).toHaveBeenCalledTimes(1);
  });

  it('keeps useful text for paused tracks and tracks without lyrics', () => {
    const service = new MenuBarLyricsService('darwin');
    service.start(vi.fn());
    const tray = electronMocks.MockTray.instances[0]!;

    service.update({
      trackId: 'track-1', title: 'Starboy', artist: 'The Weeknd', line: '', nextLine: '', isPlaying: true,
    });
    expect(tray.title).toBe('♪ Starboy');

    service.update({
      trackId: 'track-1', title: 'Starboy', artist: 'The Weeknd', line: '我们还会再见', nextLine: '', isPlaying: false,
    });
    expect(tray.title).toBe('已暂停 · 我们还会再见');
    expect(tray.contextMenu?.template[0]?.['label']).toBe('播放');
    expect(tray.toolTip).toBe('LyricsAdapter — 已暂停：Starboy — The Weeknd');
  });

  it('routes menu commands to player-intent callbacks', () => {
    const service = new MenuBarLyricsService('darwin');
    const onAction = vi.fn();
    service.start(onAction);
    service.update({
      trackId: 'track-1', title: '歌曲', artist: '歌手', line: '歌词', nextLine: '', isPlaying: true,
    });
    const template = electronMocks.MockTray.instances[0]!.contextMenu!.template;

    (template[0]?.['click'] as (() => void))();
    (template[2]?.['click'] as (() => void))();
    (template[3]?.['click'] as (() => void))();

    expect(onAction.mock.calls).toEqual([
      ['toggle-play'],
      ['previous'],
      ['next'],
    ]);
  });

  it('destroys and resets the status item on stop', () => {
    const service = new MenuBarLyricsService('darwin');
    service.start(vi.fn());
    const tray = electronMocks.MockTray.instances[0]!;

    service.stop();
    service.update({
      trackId: 'track-1', title: '歌曲', artist: '歌手', line: '不应渲染', nextLine: '', isPlaying: true,
    });

    expect(tray.destroy).toHaveBeenCalledOnce();
    expect(tray.setTitle).toHaveBeenCalledOnce();
  });
});

describe('menu bar lyric formatting', () => {
  it('truncates by grapheme and keeps the ellipsis inside the limit', () => {
    expect(truncateMenuBarText('👩‍🎤👩‍🎤👩‍🎤👩‍🎤', 3)).toBe('👩‍🎤👩‍🎤…');
  });

  it('uses the app name when no track is active', () => {
    expect(formatMenuBarLyricsTitle({
      trackId: null, title: '', artist: '', line: '', nextLine: '', isPlaying: false,
    }))
      .toBe('LyricsAdapter');
  });

  it('caps the default menu-bar title to eighteen graphemes', () => {
    const title = formatMenuBarLyricsTitle({
      trackId: 'track-1',
      title: 'Title',
      artist: 'Artist',
      line: '一二三四五六七八九十一二三四五六七八九十',
      nextLine: '',
      isPlaying: true,
    });

    expect(Array.from(title)).toHaveLength(18);
    expect(title.endsWith('…')).toBe(true);
  });
});
