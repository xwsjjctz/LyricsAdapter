import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { availableMusicSources, musicPluginState, refreshMusicPlugins } from '../services/online/musicPlugins';

export { availableMusicSources, refreshMusicPlugins, updateMusicPlugins } from '../services/online/musicPlugins';
/** The plugin list store; kept under this name for existing callers and tests. */
export const musicPluginStore = musicPluginState;

export function useMusicPlugins() {
  const state = useSyncExternalStore(musicPluginState.subscribe, musicPluginState.getSnapshot);
  useEffect(() => { if (!state.loaded) void refreshMusicPlugins(); }, [state.loaded]);
  const sources = useMemo(() => availableMusicSources(state.plugins), [state.plugins]);
  return { ...state, sources };
}
