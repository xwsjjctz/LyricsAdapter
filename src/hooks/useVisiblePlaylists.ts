import { useCallback, useEffect, useState } from 'react';
import type { PlaylistInfo } from '../services/onlineMusicProvider';
import { useOnlinePlaylists } from './useOnlinePlaylists';
import { applyOverrides, loadOverrides } from '../services/playlistOverrides';
import { logger } from '../services/logger';

interface VisiblePlaylists {
  /** Online playlists with hidden ones removed and user renames applied. */
  playlists: PlaylistInfo[];
  /** Re-reads the override store, which has no change feed of its own. */
  refresh: () => Promise<void>;
}

/** Playlists as the sidebar shows them, for sources other than the sidebar. */
export function useVisiblePlaylists(): VisiblePlaylists {
  const { playlists } = useOnlinePlaylists();
  const [visible, setVisible] = useState<PlaylistInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      setVisible(applyOverrides(playlists, await loadOverrides()).visible);
    } catch (error) {
      logger.warn('[useVisiblePlaylists] Failed to load playlist overrides:', error);
      setVisible(playlists);
    }
  }, [playlists]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { playlists: visible, refresh };
}
