import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../i18n';
import { LANGUAGE_OPTIONS } from '../components/settings/shared';
import { useOnlinePlaylists } from '../hooks/useOnlinePlaylists';
import { logger } from '../services/logger';
import type { PlaylistInfo } from '../services/onlineMusicProvider';
import {
  applyOverrides,
  loadOverrides,
  setOverride,
  type PlaylistOverride,
} from '../services/playlistOverrides';
import { buildAppCommands, type AppCommandDeps, type PlaylistEntry } from './buildAppCommands';
import type { PaletteCommand } from './paletteCommand';

/** Shell callbacks; language and playlist visibility are handled here. */
export type AppCommandHandlers = Omit<
  AppCommandDeps,
  'playlists' | 'togglePlaylistHidden' | 'languages' | 'currentLanguage' | 'setLanguage'
>;

interface AppCommands {
  commands: PaletteCommand[];
  /** Playlists the library mode lists (hidden ones removed, renames applied). */
  visiblePlaylists: PlaylistInfo[];
}

const playlistKey = (playlist: PlaylistInfo) => `${playlist.source}:${playlist.id}`;

export function useAppCommands(handlers: AppCommandHandlers): AppCommands {
  const { t, i18n } = useTranslation();
  const { playlists } = useOnlinePlaylists();
  const [overrides, setOverrides] = useState<Record<string, PlaylistOverride>>({});

  useEffect(() => {
    let cancelled = false;
    loadOverrides()
      .then(loaded => { if (!cancelled) setOverrides({ ...loaded }); })
      .catch(error => logger.warn('[Commands] Failed to load playlist overrides:', error));
    return () => { cancelled = true; };
  }, []);

  const { visible, all } = useMemo(() => applyOverrides(playlists, overrides), [overrides, playlists]);
  const playlistEntries = useMemo<PlaylistEntry[]>(
    () => all.map(playlist => ({ playlist, hidden: Boolean(overrides[playlistKey(playlist)]?.hidden) })),
    [all, overrides],
  );

  const togglePlaylistHidden = useCallback((playlist: PlaylistInfo) => {
    const hidden = !overrides[playlistKey(playlist)]?.hidden;
    setOverride(playlist.source, playlist.id, { hidden })
      .then(next => setOverrides({ ...next }))
      .catch(error => logger.warn('[Commands] Failed to update playlist visibility:', error));
  }, [overrides]);

  const setLanguage = useCallback((language: Language) => {
    void i18n.changeLanguage(language);
  }, [i18n]);

  const commands = useMemo(() => buildAppCommands({
    ...handlers,
    playlists: playlistEntries,
    togglePlaylistHidden,
    languages: LANGUAGE_OPTIONS,
    currentLanguage: i18n.language,
    setLanguage,
  }, t), [handlers, i18n.language, playlistEntries, setLanguage, t, togglePlaylistHidden]);

  return { commands, visiblePlaylists: visible };
}
