import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaletteCommand } from '../../commands/paletteCommand';
import { resolveCommandLevel, searchCommands } from '../../commands/searchCommands';
import { resolveCoverUrl, toCoverThumb } from '../../services/coverUrl';
import type { OnlineQuality, OnlineSong, OnlineSource, PlaylistInfo } from '../../services/onlineMusicProvider';
import { shortcutManager } from '../../services/shortcuts';
import { textMatchesQuery } from '../../services/trackSearch';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import type { CommandPaletteState } from '../../hooks/useCommandPalette';
import type { Track } from '../../types';

const LIBRARY_LIMIT = 6;
const ONLINE_LIMIT = 8;
/** Applies to search results only; the start page lists every playlist. */
const PLAYLIST_LIMIT = 6;
/** Rows each "show more" adds per group. */
const MORE_STEP = 20;
/** The native palette accepts at most 200 rows; keep one for "show more". */
const MAX_RESULT_ROWS = 199;

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
  /** Trailing button: queue an online result without playing it. */
  add?: { done: boolean; run: () => void } | undefined;
  /** Offered from the row's context menu. */
  download?: ((quality: OnlineQuality) => void) | undefined;
}

export interface PaletteLibrarySources {
  localTracks: Track[];
  cloudTracks: Track[];
  playlists: readonly PlaylistInfo[];
  playTrack: (track: Track) => void;
  playOnlineSong: (song: OnlineSong, source: OnlineSource) => void;
  addOnlineSong: (song: OnlineSong, source: OnlineSource) => void;
  downloadOnlineSong: (song: OnlineSong, source: OnlineSource, quality: OnlineQuality) => void;
  openPlaylist: (playlist: PlaylistInfo) => void;
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
    coverUrl: command.coverUrl === undefined ? undefined : resolveCoverUrl(command.coverUrl),
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
  const searchQuery = libraryActive ? state.query.trim() : '';
  // "Show more" pages belong to one query; a new or closed search starts over.
  const [more, setMore] = useState({ query: '', pages: 0 });
  const pages = more.query === searchQuery ? more.pages : 0;
  // Marks the rows queued from this palette; the plus becomes a check.
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const search = useGlobalSearch({
    query: searchQuery,
    active: libraryActive,
    localTracks: library.localTracks,
    cloudTracks: library.cloudTracks,
    libraryLimit: LIBRARY_LIMIT + pages * MORE_STEP,
    onlineLimit: ONLINE_LIMIT + pages * MORE_STEP,
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
    const matchingPlaylists = library.playlists.filter(playlist => !query || textMatchesQuery(playlist.name, query));
    const playlistItems = matchingPlaylists
      .slice(0, query ? PLAYLIST_LIMIT + pages * MORE_STEP : MAX_RESULT_ROWS)
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
      return { items: [...sources, ...playlistItems].slice(0, MAX_RESULT_ROWS), trail: [], onlineLoading: false };
    }

    const localSection = t('sidebar.local');
    const cloudSection = t('sidebar.cloud');
    const onlineSection = t('sidebar.onlineMusic');
    const results: PaletteItem[] = [
      ...search.local.items.map(track => trackItem(track, localSection, () => library.playTrack(track))),
      ...search.cloud.items.map(track => trackItem(track, cloudSection, () => library.playTrack(track))),
      ...playlistItems,
      ...search.online.map(({ source, song }): PaletteItem => {
        const key = `online:${source}:${song.songmid}`;
        return {
          key,
          section: onlineSection,
          title: song.songname,
          subtitle: [song.singer.map(singer => singer.name).join(' / '), t(source === 'qq' ? 'search.sourceQq' : 'search.sourceNetease')]
            .filter(Boolean).join(' · '),
          icon: 'cloud_download',
          coverUrl: resolveCoverUrl(song.coverUrl),
          run: () => library.playOnlineSong(song, source),
          add: {
            done: added.has(key),
            run: () => { library.addOnlineSong(song, source); setAdded(previous => new Set(previous).add(key)); },
          },
          download: quality => library.downloadOnlineSong(song, source, quality),
        };
      }),
    ];
    const items = results.slice(0, MAX_RESULT_ROWS);
    const hasMore = search.local.total > search.local.items.length || search.cloud.total > search.cloud.items.length
      || matchingPlaylists.length > playlistItems.length || search.onlineHasMore;
    const last = items.at(-1);
    // Stays in the list after running, so the next page appears under the selection.
    if (last && hasMore && results.length <= MAX_RESULT_ROWS && !search.onlineLoading) {
      items.push({
        key: 'show-more',
        section: last.section,
        title: t('palette.showMore'),
        icon: 'expand_more',
        keepOpen: true,
        run: () => setMore({ query, pages: pages + 1 }),
      });
    }
    return { items, trail: [], onlineLoading: search.onlineLoading };
  }, [added, commands, library, pages, search.cloud, search.local, search.online, search.onlineHasMore, search.onlineLoading, state.mode, state.query, state.stack, t]);
}
