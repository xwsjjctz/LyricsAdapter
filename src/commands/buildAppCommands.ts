import type { TFunction } from 'i18next';
import type { SettingsSectionId } from '../components/settings/SettingsView';
import type { PlaylistInfo } from '../services/onlineMusicProvider';
import type { Language } from '../i18n';
import type { PaletteCommand } from './paletteCommand';

export type PaletteSourceSlot = 'local' | 'cloud' | 'online';

export interface PlaylistEntry {
  playlist: PlaylistInfo;
  hidden: boolean;
}

/** Everything the feature commands can do; the shell supplies live callbacks. */
export interface AppCommandDeps {
  trackCounts: Record<PaletteSourceSlot, number>;
  switchSource: (slot: PaletteSourceSlot) => void;
  playlists: readonly PlaylistEntry[];
  openPlaylist: (playlist: PlaylistInfo) => void;
  togglePlaylistHidden: (playlist: PlaylistInfo) => void;
  importFiles: () => void;
  importDisabled: boolean;
  reloadFiles: () => void;
  hasUnavailableTracks: boolean;
  /** Present only while the shown list can be multi-selected. */
  selectTracks?: (() => void) | undefined;
  /** Present only while the cloud source is shown. */
  refreshCloud?: (() => void) | undefined;
  /** Present only while the shown list has tracks to play. */
  playAll?: (() => void) | undefined;
  shuffleAll?: (() => void) | undefined;
  /** Present only while a track is playing: scroll (or switch source) to it. */
  locateCurrentTrack?: (() => void) | undefined;
  toggleFocusMode: () => void;
  togglePlaybackMode: () => void;
  toggleMute: () => void;
  isDark: boolean;
  toggleNightMode: () => void;
  languages: readonly { value: Language; nativeLabel: string }[];
  currentLanguage: string;
  setLanguage: (language: Language) => void;
  openSettings: (section: SettingsSectionId) => void;
  /** Back to the library page (from search results), in its current layout. */
  openWall: () => void;
  libraryLayout: 'wall' | 'list';
  setLibraryLayout: (layout: 'wall' | 'list') => void;
}

const SETTINGS_SECTIONS: { id: SettingsSectionId; icon: string; titleKey: string; keywords: string[] }[] = [
  { id: 'general', icon: 'tune', titleKey: 'settings.nav.general', keywords: ['general', 'settings'] },
  { id: 'online', icon: 'language', titleKey: 'settings.nav.online', keywords: ['online', 'qq', 'netease', 'login'] },
  { id: 'cloud', icon: 'cloud', titleKey: 'settings.nav.cloud', keywords: ['webdav', 'cloud'] },
  { id: 'focus', icon: 'fullscreen', titleKey: 'settings.nav.focus', keywords: ['focus', 'lyrics'] },
  { id: 'shortcuts', icon: 'keyboard', titleKey: 'settings.shortcuts.title', keywords: ['shortcuts', 'keyboard', 'hotkey'] },
];

function sourceCommands(deps: AppCommandDeps, t: TFunction): PaletteCommand[] {
  const sources: { slot: PaletteSourceSlot; icon: string; keywords: string[] }[] = [
    { slot: 'local', icon: 'hard_drive', keywords: ['local', 'library'] },
    { slot: 'cloud', icon: 'cloud', keywords: ['cloud', 'webdav'] },
    { slot: 'online', icon: 'history', keywords: ['online', 'recent'] },
  ];
  return sources.map(({ slot, icon, keywords }) => ({
    id: `source.${slot}`,
    title: t('palette.command.switchSource', { source: t(`sidebar.${slot}`) }),
    icon,
    group: 'library',
    keywords,
    detail: String(deps.trackCounts[slot]),
    run: () => deps.switchSource(slot),
  }));
}

function playlistCommands(deps: AppCommandDeps, t: TFunction): PaletteCommand[] {
  const visible = deps.playlists.filter(entry => !entry.hidden);
  return [
    {
      id: 'playlist.open',
      title: t('palette.command.openPlaylist'),
      icon: 'queue_music',
      group: 'library',
      keywords: ['playlist'],
      detail: String(visible.length),
      children: () => visible.map(({ playlist }) => ({
        id: `playlist.open.${playlist.source}.${playlist.id}`,
        title: playlist.name,
        icon: 'queue_music',
        group: 'library',
        detail: String(playlist.songCount),
        run: () => deps.openPlaylist(playlist),
      })),
    },
    {
      id: 'playlist.manage',
      title: t('palette.command.managePlaylists'),
      icon: 'visibility',
      group: 'library',
      keywords: ['playlist', 'hide', 'show'],
      children: () => deps.playlists.map(({ playlist, hidden }) => ({
        id: `playlist.toggle.${playlist.source}.${playlist.id}`,
        title: playlist.name,
        icon: hidden ? 'visibility_off' : 'visibility',
        group: 'library',
        detail: hidden ? t('palette.state.hidden') : t('palette.state.shown'),
        keepOpen: true,
        run: () => deps.togglePlaylistHidden(playlist),
      })),
    },
  ];
}

function libraryCommands(deps: AppCommandDeps, t: TFunction): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  if (!deps.importDisabled) {
    commands.push({
      id: 'library.import', title: t('sidebar.importFiles'), icon: 'library_add', group: 'library',
      keywords: ['import', 'add', 'files'], run: deps.importFiles,
    });
  }
  if (deps.selectTracks) {
    commands.push({
      id: 'library.select', title: t('library.selectMultiple'), icon: 'checklist', group: 'library',
      keywords: ['select', 'multiple', 'remove', 'batch'], run: deps.selectTracks,
    });
  }
  if (deps.refreshCloud) {
    commands.push({
      id: 'library.refreshCloud', title: t('palette.command.refreshCloud'), icon: 'sync', group: 'library',
      keywords: ['refresh', 'sync', 'cloud', 'webdav'], run: deps.refreshCloud,
    });
  }
  if (deps.hasUnavailableTracks) {
    commands.push({
      id: 'library.reload', title: t('sidebar.reloadFiles'), icon: 'refresh', group: 'library',
      keywords: ['reload', 'refresh', 'missing'], run: deps.reloadFiles,
    });
  }
  return commands;
}

function playbackCommands(deps: AppCommandDeps, t: TFunction): PaletteCommand[] {
  const commands: PaletteCommand[] = [];
  if (deps.playAll) {
    commands.push({ id: 'playback.playAll', title: t('library.playAll'), icon: 'play_arrow', group: 'playback', keywords: ['play all'], run: deps.playAll });
  }
  if (deps.shuffleAll) {
    commands.push({ id: 'playback.shuffleAll', title: t('library.shuffleAll'), icon: 'shuffle', group: 'playback', keywords: ['shuffle'], run: deps.shuffleAll });
  }
  if (deps.locateCurrentTrack) {
    commands.push({
      id: 'playback.locate', title: t('library.locateToCurrent'), icon: 'my_location', group: 'playback',
      keywords: ['locate', 'now playing', 'current', 'scroll'], run: deps.locateCurrentTrack,
    });
  }
  commands.push(
    {
      id: 'playback.focusMode', title: t('titleBar.enterFocusMode'), icon: 'fullscreen', group: 'playback',
      keywords: ['focus', 'lyrics', 'immersive'], shortcut: 'toggleFocusMode', run: deps.toggleFocusMode,
    },
    {
      id: 'playback.mode', title: t('shortcut.togglePlaybackMode'), icon: 'repeat', group: 'playback',
      keywords: ['repeat', 'shuffle', 'mode'], shortcut: 'togglePlaybackMode', keepOpen: true, run: deps.togglePlaybackMode,
    },
    {
      id: 'playback.mute', title: t('shortcut.toggleMute'), icon: 'volume_off', group: 'playback',
      keywords: ['mute', 'volume'], shortcut: 'toggleMute', keepOpen: true, run: deps.toggleMute,
    },
  );
  return commands;
}

function appearanceCommands(deps: AppCommandDeps, t: TFunction): PaletteCommand[] {
  return [
    {
      id: 'appearance.nightMode', title: t('settings.nightMode'), icon: deps.isDark ? 'dark_mode' : 'light_mode',
      group: 'appearance', keywords: ['dark', 'light', 'theme', 'night'],
      detail: deps.isDark ? t('palette.state.on') : t('palette.state.off'), keepOpen: true, run: deps.toggleNightMode,
    },
    {
      id: 'appearance.language', title: t('settings.language'), icon: 'translate', group: 'appearance',
      keywords: ['language', 'locale'],
      detail: deps.languages.find(option => option.value === deps.currentLanguage)?.nativeLabel,
      children: () => deps.languages.map(option => ({
        id: `appearance.language.${option.value}`,
        title: option.nativeLabel,
        icon: option.value === deps.currentLanguage ? 'check' : 'translate',
        group: 'appearance',
        run: () => deps.setLanguage(option.value),
      })),
    },
  ];
}

function settingsCommands(deps: AppCommandDeps, t: TFunction): PaletteCommand[] {
  return [
    {
      id: 'settings.open', title: t('settings.title'), icon: 'settings', group: 'settings',
      keywords: ['settings', 'preferences'], shortcut: 'gotoSettings', run: () => deps.openSettings('general'),
    },
    ...SETTINGS_SECTIONS.map(section => ({
      id: `settings.${section.id}`,
      title: `${t('settings.title')} › ${t(section.titleKey)}`,
      icon: section.icon,
      group: 'settings' as const,
      keywords: section.keywords,
      run: () => deps.openSettings(section.id),
    })),
    {
      id: 'settings.about', title: t('settings.about'), icon: 'info', group: 'settings',
      keywords: ['about', 'version', 'update'], run: () => deps.openSettings('general'),
    },
  ];
}

function navigationCommands(deps: AppCommandDeps, t: TFunction): PaletteCommand[] {
  const onList = deps.libraryLayout === 'list';
  return [
    {
      id: 'navigation.wall', title: t(onList ? 'palette.command.showList' : 'palette.command.showWall'),
      icon: onList ? 'view_list' : 'auto_awesome_mosaic', group: 'navigation',
      keywords: ['wall', 'list', 'home', 'library', 'back'], run: deps.openWall,
    },
    // The poster wall is the default; the classic list stays one command away.
    onList
      ? {
        id: 'navigation.useWall', title: t('palette.command.useWallLayout'), icon: 'auto_awesome_mosaic',
        group: 'navigation', keywords: ['wall', 'poster', 'cover', 'grid', 'layout'],
        run: () => deps.setLibraryLayout('wall'),
      }
      : {
        id: 'navigation.list', title: t('palette.command.useListLayout'), icon: 'view_list',
        group: 'navigation', keywords: ['list', 'classic', 'legacy', 'traditional', 'rows', 'layout'],
        run: () => deps.setLibraryLayout('list'),
      },
  ];
}

/** The full feature list, ordered by group as the palette shows it. */
export function buildAppCommands(deps: AppCommandDeps, t: TFunction): PaletteCommand[] {
  return [
    ...navigationCommands(deps, t),
    ...sourceCommands(deps, t),
    ...playlistCommands(deps, t),
    ...libraryCommands(deps, t),
    ...playbackCommands(deps, t),
    ...appearanceCommands(deps, t),
    ...settingsCommands(deps, t),
  ];
}
