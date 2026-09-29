import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaletteCommand } from '../../commands/paletteCommand';
import { resolveCommandLevel, searchCommands } from '../../commands/searchCommands';
import { resolveCoverUrl, toCoverThumb } from '../../services/coverUrl';
import type { OnlineSong, OnlineSource, PlaylistInfo } from '../../services/onlineMusicProvider';
import { shortcutManager } from '../../services/shortcuts';
import { textMatchesQuery } from '../../services/trackSearch';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import type { CommandPaletteState } from '../../hooks/useCommandPalette';
import type { Track } from '../../types';

const LIBRARY_LIMIT = 6;
const ONLINE_LIMIT = 8;
const PLAYLIST_LIMIT = 6;

/** One row in the palette, whatever it came from. */
export interface PaletteItem {
  key: string;
  section: string;
  title: string;
  subtitle?: string | undefined;
  detail?: string | undefined;
  shortcut?: string | undefined;
  icon?: string | undefined;
  coverUrl?: string | undefined;
  /** Enter/Tab opens a nested list instead of running. */
  command?: PaletteCommand | undefined;
  keepOpen?: boolean | undefined;
  run: () => void;
}

export interface PaletteLibrarySources {
  localTracks: Track[];
  cloudTracks: Track[];
  playlists: readonly PlaylistInfo[];
  playTrack: (track: Track) => void;
  playOnlineSong: (song: OnlineSong, source: OnlineSource) => void;
  openPlaylist: (playlist: PlaylistInfo) => void;
  openAllResults: (query: string) => void;
}

export interface PaletteItemsResult {
  items: PaletteItem[];
  trail: string[];
  onlineLoading: boolean;
}

function commandItem(command: PaletteCommand, section: string, path: string[]): PaletteItem {
  const shortcut = command.shortcut ? shortcutManager.getShortcut(command.shortcut)?.currentKey : undefined;
  return {
    key: `command:${command.id}`,
    section,
    title: path.length > 0 ? `${path.join(' › ')} › ${command.title}` : command.title,
    detail: command.detail,
    shortcut: shortcut ? shortcutManager.formatKeyForDisplay(shortcut) : undefined,
    icon: command.icon,
    command: command.children ? command : undefined,
    keepOpen: command.keepOpen,
    run: () => { void command.run?.(); },
  };
}

function trackItem(track: Track, section: string, run: () => void): PaletteItem {
  return {
    key: `${section}:${track.id}`,
    section,
    title: track.title,
    subtitle: [track.artist, track.album].filter(Boolean).join(' · '),
    coverUrl: toCoverThumb(resolveCoverUrl(track.coverUrl), 96),
    icon: 'music_note',
    run,
  };
}

/** Rows for the palette's current mode, query and nested level. */
export function usePaletteItems(
  state: CommandPaletteState,
  commands: readonly PaletteCommand[],
  library: PaletteLibrarySources,
): PaletteItemsResult {
  const { t } = useTranslation();
  const libraryActive = state.open && state.mode === 'library';
  const search = useGlobalSearch({
    query: libraryActive ? state.query : '',
    active: libraryActive,
    localTracks: library.localTracks,
    cloudTracks: library.cloudTracks,
    libraryLimit: LIBRARY_LIMIT,
    onlineLimit: ONLINE_LIMIT,
  });

  return useMemo(() => {
    if (state.mode === 'commands') {
      const level = resolveCommandLevel(commands, state.stack);
      const nested = level.trail.length > 0;
      const items = searchCommands(level.commands, state.query).map(({ command, path }) =>
        commandItem(command, nested ? level.trail.at(-1)! : t(`palette.group.${command.group}`), path));
      return { items, trail: level.trail, onlineLoading: false };
    }

    const query = state.query.trim();
    const playlistSection = t('sidebar.playlists');
    const playlistItems = library.playlists
      .filter(playlist => !query || textMatchesQuery(playlist.name, query))
      .slice(0, PLAYLIST_LIMIT)
      .map((playlist): PaletteItem => ({
        key: `playlist:${playlist.source}:${playlist.id}`,
        section: playlistSection,
        title: playlist.name,
        detail: String(playlist.songCount),
        icon: 'queue_music',
        coverUrl: resolveCoverUrl(playlist.coverUrl),
        run: () => library.openPlaylist(playlist),
      }));

    if (!query) {
      const sources = commands.filter(command => command.id.startsWith('source.'))
        .map(command => commandItem(command, t('sidebar.library'), []));
      return { items: [...sources, ...playlistItems], trail: [], onlineLoading: false };
    }

    const localSection = t('sidebar.local');
    const cloudSection = t('sidebar.cloud');
    const onlineSection = t('sidebar.onlineMusic');
    const items: PaletteItem[] = [
      ...search.local.items.map(track => trackItem(track, localSection, () => library.playTrack(track))),
      ...search.cloud.items.map(track => trackItem(track, cloudSection, () => library.playTrack(track))),
      ...playlistItems,
      ...search.online.map(({ source, song }): PaletteItem => ({
        key: `online:${source}:${song.songmid}`,
        section: onlineSection,
        title: song.songname,
        subtitle: [song.singer.map(singer => singer.name).join(' / '), t(source === 'qq' ? 'search.sourceQq' : 'search.sourceNetease')]
          .filter(Boolean).join(' · '),
        icon: 'cloud_download',
        coverUrl: resolveCoverUrl(song.coverUrl),
        run: () => library.playOnlineSong(song, source),
      })),
      {
        key: 'view-all',
        section: t('search.resultsSubtitle'),
        title: t('palette.viewAllResults', { query }),
        icon: 'manage_search',
        run: () => library.openAllResults(query),
      },
    ];
    return { items, trail: [], onlineLoading: search.onlineLoading };
  }, [commands, library, search.cloud.items, search.local.items, search.online, search.onlineLoading, state.mode, state.query, state.stack, t]);
}
