import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import { settingsManager } from '../services/settingsManager';
import type { MusicPluginInfo } from '../shared/musicPlugin';
import type { OnlineSource } from '../shared/onlineMusic';

interface PluginState { plugins: MusicPluginInfo[]; loaded: boolean; error: string }
let snapshot: PluginState = { plugins: [], loaded: false, error: '' };
const listeners = new Set<() => void>();
export const musicPluginStore = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  setState: (state: Partial<PluginState>) => { snapshot = { ...snapshot, ...state }; listeners.forEach(listener => listener()); },
};
let revision = 0;
let pending: Promise<void> | null = null;
let initialized = false;

export function availableMusicSources(plugins: MusicPluginInfo[]): OnlineSource[] {
  return plugins.filter(plugin => plugin.enabled && !plugin.error && plugin.capabilities.includes('search')
    && (plugin.id === 'qq' || plugin.id === 'netease')).map(plugin => plugin.id as OnlineSource);
}

export function updateMusicPlugins(plugins: MusicPluginInfo[]): void {
  revision++;
  musicPluginStore.setState({ plugins, loaded: true, error: '' });
  const sources = availableMusicSources(plugins);
  if (sources.length && !sources.includes(settingsManager.getOnlineSource())) {
    void settingsManager.setOnlineSource(sources[0]!);
  }
}

export function refreshMusicPlugins(): Promise<void> {
  if (pending) return pending;
  const api = getDesktopAPI();
  if (!initialized && api) {
    initialized = true;
    api.onMusicPluginsChanged?.(updateMusicPlugins);
  }
  const currentRevision = revision;
  pending = (async () => {
    try {
      const plugins = await api?.musicPluginList?.() ?? [];
      if (currentRevision === revision) updateMusicPlugins(plugins);
    } catch (error) {
      if (currentRevision === revision) musicPluginStore.setState({ loaded: true, error: String(error) });
    }
  })().finally(() => { pending = null; });
  return pending;
}

export function useMusicPlugins() {
  const state = useSyncExternalStore(musicPluginStore.subscribe, musicPluginStore.getSnapshot);
  useEffect(() => { if (!state.loaded) void refreshMusicPlugins(); }, [state.loaded]);
  const sources = useMemo(() => availableMusicSources(state.plugins), [state.plugins]);
  return { ...state, sources };
}
