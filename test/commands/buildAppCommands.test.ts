import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { buildAppCommands, type AppCommandDeps } from '@/commands/buildAppCommands';
import { resolveCommandLevel, searchCommands } from '@/commands/searchCommands';
import type { PaletteCommand } from '@/commands/paletteCommand';
import type { PlaylistInfo } from '@/services/onlineMusicProvider';

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join(',')})` : key) as unknown as TFunction;

const playlist = (id: string, name: string): PlaylistInfo => ({ id, name, coverUrl: '', songCount: 3, source: 'netease' });

function deps(overrides: Partial<AppCommandDeps> = {}): AppCommandDeps {
  return {
    trackCounts: { local: 12, cloud: 0, online: 4 },
    switchSource: vi.fn(),
    playlists: [
      { playlist: playlist('a', 'Road Trip'), hidden: false },
      { playlist: playlist('b', '深夜'), hidden: true },
    ],
    openPlaylist: vi.fn(),
    togglePlaylistHidden: vi.fn(),
    importFiles: vi.fn(),
    importDisabled: false,
    reloadFiles: vi.fn(),
    hasUnavailableTracks: false,
    playAll: vi.fn(),
    shuffleAll: vi.fn(),
    toggleFocusMode: vi.fn(),
    togglePlaybackMode: vi.fn(),
    toggleMute: vi.fn(),
    isDark: true,
    toggleNightMode: vi.fn(),
    languages: [{ value: 'zh', nativeLabel: '中文' }, { value: 'en', nativeLabel: 'English' }],
    currentLanguage: 'zh',
    setLanguage: vi.fn(),
    openSettings: vi.fn(),
    openWall: vi.fn(),
    ...overrides,
  };
}

const byId = (commands: PaletteCommand[], id: string) => commands.find(command => command.id === id);

describe('buildAppCommands', () => {
  it('covers every migrated entry point', () => {
    const ids = buildAppCommands(deps(), t).map(command => command.id);
    expect(ids).toEqual(expect.arrayContaining([
      'navigation.wall', 'source.local', 'source.cloud', 'source.online', 'playlist.open', 'playlist.manage',
      'library.import', 'playback.playAll', 'playback.shuffleAll', 'playback.focusMode', 'playback.mode',
      'playback.mute', 'appearance.nightMode', 'appearance.language', 'settings.open', 'settings.general',
      'settings.online', 'settings.cloud', 'settings.focus', 'settings.shortcuts', 'settings.about',
    ]));
  });

  it('omits commands that cannot run right now', () => {
    const ids = buildAppCommands(deps({ importDisabled: true, playAll: undefined, shuffleAll: undefined }), t)
      .map(command => command.id);
    expect(ids).not.toContain('library.import');
    expect(ids).not.toContain('playback.playAll');
    expect(ids).not.toContain('library.reload');
    expect(buildAppCommands(deps({ hasUnavailableTracks: true }), t).map(command => command.id)).toContain('library.reload');
  });

  it('routes sources, settings sections and nested lists to their handlers', () => {
    const handlers = deps();
    const commands = buildAppCommands(handlers, t);
    void byId(commands, 'source.online')!.run!();
    void byId(commands, 'settings.cloud')!.run!();
    expect(handlers.switchSource).toHaveBeenCalledWith('online');
    expect(handlers.openSettings).toHaveBeenCalledWith('cloud');
    expect(byId(commands, 'source.local')!.detail).toBe('12');

    const openable = byId(commands, 'playlist.open')!.children!();
    expect(openable.map(command => command.title)).toEqual(['Road Trip']);
    void openable[0]!.run!();
    expect(handlers.openPlaylist).toHaveBeenCalledWith(handlers.playlists[0]!.playlist);

    const manageable = byId(commands, 'playlist.manage')!.children!();
    expect(manageable.map(command => command.detail)).toEqual(['palette.state.shown', 'palette.state.hidden']);
    expect(manageable.every(command => command.keepOpen)).toBe(true);

    const languages = byId(commands, 'appearance.language')!.children!();
    void languages[1]!.run!();
    expect(handlers.setLanguage).toHaveBeenCalledWith('en');
  });
});

describe('searchCommands', () => {
  const commands = buildAppCommands(deps(), t);

  it('lists the level unchanged for an empty query', () => {
    expect(searchCommands(commands, '  ').map(hit => hit.command.id)).toEqual(commands.map(command => command.id));
  });

  it('ranks title prefixes first and falls back to keywords', () => {
    const ids = searchCommands(commands, 'settings.title').map(hit => hit.command.id);
    expect(ids[0]).toBe('settings.open');
    expect(searchCommands(commands, 'webdav').map(hit => hit.command.id)).toEqual(
      expect.arrayContaining(['source.cloud', 'settings.cloud']),
    );
  });

  it('finds nested entries with their parent path', () => {
    const hit = searchCommands(commands, 'English').find(entry => entry.command.id === 'appearance.language.en');
    expect(hit?.path).toEqual(['settings.language']);
    const pinyin = searchCommands(commands, 'sy').find(entry => entry.command.title === '深夜');
    expect(pinyin?.path).toEqual(['palette.command.managePlaylists']);
  });

  it('resolves nested levels from ids and stops at a vanished parent', () => {
    expect(resolveCommandLevel(commands, ['appearance.language'])).toMatchObject({
      trail: ['settings.language'],
      commands: [expect.objectContaining({ title: '中文' }), expect.objectContaining({ title: 'English' })],
    });
    expect(resolveCommandLevel(commands, ['missing']).trail).toEqual([]);
  });
});
