import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlaylistInfo } from '../../services/onlineMusicProvider';
import type { WallChromeMenuSection } from '../../types/wallChrome';
import { getDesktopAPI } from '../../services/desktopAdapter';
import { getMacTitleBarLayout } from '../../shared/macTitleBarLayout';
import { useVisiblePlaylists } from '../../hooks/useVisiblePlaylists';
import { useWallChromeGlass } from '../../hooks/useWallChromeGlass';
import IconButton from '../ui/IconButton';
import LibrarySourceMenu, { type LibrarySource } from '../LibrarySourceMenu';

/** Windows/Linux custom title bar height (h-9). */
const FRAMELESS_TITLE_BAR_HEIGHT = 36;

interface WallChromeProps {
  current: LibrarySource | null;
  title: string;
  counts: { local: number; online: number };
  onBack: () => void;
  onSelectSlot: (slot: 'local' | 'online') => void;
  onOpenPlaylist: (playlist: PlaylistInfo) => void;
}

const playlistItemId = (playlist: PlaylistInfo) => `playlist:${playlist.source}:${playlist.id}`;

/**
 * Floating back button + source switcher over the poster wall. On macOS 26+
 * it is drawn natively in Liquid Glass with the system menu; this element then
 * only marks its position. Elsewhere it renders the web version.
 */
const WallChrome: React.FC<WallChromeProps> = ({ current, title, counts, onBack, onSelectSlot, onOpenPlaylist }) => {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const { playlists, refresh } = useVisiblePlaylists();
  const desktop = getDesktopAPI();
  // Sit just below the title bar so the chrome never covers the traffic lights.
  const top = (desktop?.platform === 'darwin'
    ? getMacTitleBarLayout(desktop.osRelease).height
    : FRAMELESS_TITLE_BAR_HEIGHT) + 8;

  const sections = useMemo<WallChromeMenuSection[]>(() => {
    const library: WallChromeMenuSection = {
      title: t('sidebar.library'),
      items: [
        { id: 'slot:local', title: t('sidebar.local'), count: counts.local, icon: 'local', imageUrl: null,
          checked: current?.kind === 'slot' && current.slot === 'local' },
        { id: 'slot:online', title: t('sidebar.online'), count: counts.online, icon: 'history', imageUrl: null,
          checked: current?.kind === 'slot' && current.slot === 'online' },
      ],
    };
    if (playlists.length === 0) return [library];
    return [library, {
      title: t('sidebar.playlists'),
      items: playlists.map(playlist => ({
        id: playlistItemId(playlist),
        title: playlist.name,
        count: playlist.songCount,
        icon: 'playlist' as const,
        imageUrl: playlist.coverUrl || null,
        checked: current?.kind === 'playlist' && current.source === playlist.source && current.id === playlist.id,
      })),
    }];
  }, [counts.local, counts.online, current, playlists, t]);

  const selectById = useCallback((id: string) => {
    if (id === 'slot:local' || id === 'slot:online') {
      onSelectSlot(id === 'slot:local' ? 'local' : 'online');
      return;
    }
    const playlist = playlists.find(entry => playlistItemId(entry) === id);
    if (playlist) onOpenPlaylist(playlist);
  }, [onOpenPlaylist, onSelectSlot, playlists]);

  const labels = useMemo(() => ({
    back: t('wall.back'),
    source: t('library.switchSource', { source: title }),
  }), [t, title]);

  const native = useWallChromeGlass({ anchorRef, title, labels, sections, onBack, onSelect: selectById });

  if (native) {
    // Invisible placeholder the native glass tracks; it also detects covering layers.
    return <div ref={anchorRef} className="wall-chrome-anchor" style={{ top }} aria-hidden="true" />;
  }

  return (
    <div ref={anchorRef} className="wall-chrome" style={{ top }}>
      <IconButton icon="arrow_back" label={labels.back} size="md" onClick={onBack} />
      <LibrarySourceMenu
        current={current}
        title={title}
        counts={counts}
        playlists={playlists}
        onOpen={refresh}
        onSelectSlot={onSelectSlot}
        onOpenPlaylist={onOpenPlaylist}
      />
    </div>
  );
};

export default WallChrome;
