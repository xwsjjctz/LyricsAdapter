import { getDesktopAPI } from './desktopAdapter';
import { settingsManager } from './settingsManager';
import type { MusicPluginInfo } from '../shared/musicPlugin';
import type { OnlineSource } from '../shared/onlineMusic';

/**
 * Installed music plugins as reported by the main process. Services read it
 * synchronously (source capabilities, cookie requirements); React subscribes
 * through stores/musicPluginStore.
 */
interface PluginState { plugins: MusicPluginInfo[]; loaded: boolean; error: string }
let snapshot: PluginState = { plugins: [], loaded: false, error: '' };
const listeners = new Set<() => void>();
export const musicPluginState = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  setState: (state: Partial<PluginState>) => { snapshot = { ...snapshot, ...state }; listeners.forEach(listener => listener()); },
};
let revision = 0;
let pending: Promise<void> | null = null;
let initialized = false;

/** Enabled, healthy plugins that can search; each one is a selectable music source. */
export function availableMusicSources(plugins: MusicPluginInfo[]): OnlineSource[] {
  return plugins.filter(plugin => plugin.enabled && !plugin.error && plugin.capabilities.includes('search'))
    .map(plugin => plugin.id);
}

export function getMusicPluginInfo(id: OnlineSource): MusicPluginInfo | undefined {
  return snapshot.plugins.find(plugin => plugin.id === id);
}

export function updateMusicPlugins(plugins: MusicPluginInfo[]): void {
  revision++;
  musicPluginState.setState({ plugins, loaded: true, error: '' });
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
      if (currentRevision === revision) musicPluginState.setState({ loaded: true, error: String(error) });
    }
  })().finally(() => { pending = null; });
  return pending;
}
