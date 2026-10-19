import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { refreshMusicPlugins, updateMusicPlugins, useMusicPlugins } from '@/stores/musicPluginStore';
import type { MusicPluginCatalogEntry, MusicPluginInfo } from '@/shared/musicPlugin';
import type { SettingsTheme } from '../shared';
import ConfirmDialog from '../../ConfirmDialog';
import Button from '../../ui/Button';
import SettingsMessage from '../SettingsMessage';
import InstalledPluginList from './InstalledPluginList';
import PluginCatalog, { downloadKey } from './PluginCatalog';
import { usePluginUpdates } from '@/hooks/usePluginUpdates';

/** A failed operation, named by the same key as `busy` so it shows beside its own button. */
interface Failure {
  key: string;
  message: string;
}

/** One page: installed plugins first, then the official ones still to install. */
export default function MusicPluginManager({ theme }: { theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { plugins, error: loadError } = useMusicPlugins();
  const { updates, error: updateError, setUpdates } = usePluginUpdates();
  const [catalog, setCatalog] = useState<MusicPluginCatalogEntry[]>([]);
  const [directory, setDirectory] = useState('');
  // One operation at a time; the key names it so only its own button reads "working".
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [reload, setReload] = useState(0);
  const [uninstalling, setUninstalling] = useState<MusicPluginInfo | null>(null);
  const api = getDesktopAPI();
  const describe = (reason: unknown) => /net::ERR_|TimeoutError|fetch failed/.test(String(reason)) ? t('musicPlugins.networkError') : String(reason);
  const errorFor = (...keys: string[]) => failure && keys.includes(failure.key) ? failure.message : undefined;
  const notInstalled = catalog.filter(item => !plugins.some(plugin => plugin.id === item.id));
  const rootRef = useRef<HTMLDivElement>(null);
  // Settings is one scrolling list, so this mounts whenever it opens. The official catalog
  // is a network request: fetch it only once the section has been scrolled into view.
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const root = rootRef.current;
    if (seen || !root) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [seen]);

  useEffect(() => {
    let mounted = true;
    void (api?.musicPluginDirectory?.() ?? Promise.resolve('')).then(value => {
      if (mounted) setDirectory(value);
    }).catch(reason => { if (mounted) setDirectoryError(String(reason)); });
    return () => { mounted = false; };
  }, [api]);

  useEffect(() => {
    if (!seen) return;
    let mounted = true;
    setLoadingCatalog(true); setCatalogError('');
    void (api?.musicPluginCatalog?.() ?? Promise.resolve([])).then(value => {
      if (mounted) setCatalog(value);
    }).catch(reason => { if (mounted) setCatalogError(describe(reason)); })
      .finally(() => { if (mounted) setLoadingCatalog(false); });
    return () => { mounted = false; };
  }, [api, reload, seen]);

  /** Runs one operation; its error stays beside its button until the next attempt. */
  const change = async (key: string, operation: () => Promise<MusicPluginInfo[] | null | void>): Promise<boolean> => {
    setBusy(key); setFailure(null);
    try {
      const value = await operation();
      if (value) updateMusicPlugins(value);
      return true;
    } catch (reason) {
      setFailure({ key, message: describe(reason) });
      await refreshMusicPlugins();
      return false;
    } finally { setBusy(null); }
  };
  const uninstallKey = uninstalling ? `uninstall:${uninstalling.id}` : '';
  // A failed uninstall keeps the dialog open with the reason.
  const confirmUninstall = async () => {
    if (!uninstalling) return;
    if (await change(uninstallKey, () => api!.musicPluginUninstall!(uninstalling.id))) setUninstalling(null);
  };
  const { colors } = theme;
  const installError = errorFor('install');
  const openDirectoryError = errorFor('directory') ?? directoryError;
  return (
    <div ref={rootRef} className="space-y-6" data-testid="music-plugin-manager">
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs" style={{ color: colors.textSecondary }}>{t('musicPlugins.description')}</p>
          <Button size="sm" disabled={!!busy || !api} onClick={() => void change('install', () => api!.musicPluginInstall!())}>{t('musicPlugins.install')}</Button>
        </div>
        {installError && <SettingsMessage tone="error">{installError}</SettingsMessage>}
      </div>
      {/* A failed update reports itself in the plugin's update status, so the card shows only the rest. */}
      <InstalledPluginList theme={theme} plugins={plugins} updates={updates} busy={busy} available={!!api}
        listError={errorFor('updates') ?? (loadError || updateError || undefined)}
        errorFor={id => errorFor(`enable:${id}`, `source:${id}`)}
        onCheckUpdates={() => void change('updates', async () => { setUpdates(await api!.pluginCheckUpdates!()); })}
        onSetEnabled={(plugin, enabled) => void change(`enable:${plugin.id}`, () => api!.musicPluginSetEnabled!(plugin.id, enabled))}
        onUninstall={plugin => { setFailure(null); setUninstalling(plugin); }}
        onUpdate={id => void change(`update:${id}`, () => api!.pluginUpdate!(id))}
        onSetUpdateSource={(id, source) => void change(`source:${id}`, async () => {
          setUpdates(await api!.pluginSetUpdateSource!(id, source)); setUpdates(await api!.pluginCheckUpdates!());
        })} />
      <PluginCatalog theme={theme} catalog={notInstalled} loading={loadingCatalog} error={catalogError} busy={busy} available={!!api}
        errorFor={id => errorFor(downloadKey(id))}
        onRefresh={() => setReload(value => value + 1)}
        onDownload={id => void change(downloadKey(id), () => api!.musicPluginDownload!(id))} />
      <section className="text-xs space-y-2" style={{ color: colors.textSecondary }}>
        <p>{t('musicPlugins.directory')}</p>
        <p className="break-all select-text" data-testid="plugin-directory">{directory || t('musicPlugins.desktopOnly')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!!busy || !directory} onClick={() => void change('directory', () => api!.musicPluginOpenDirectory!())}>{t('musicPlugins.openDirectory')}</Button>
          <a href="https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins" target="_blank" rel="noreferrer" className="underline" style={{ color: colors.primary }}>{t('musicPlugins.repository')}</a>
        </div>
        {openDirectoryError && <SettingsMessage tone="error">{openDirectoryError}</SettingsMessage>}
      </section>
      <ConfirmDialog
        isOpen={!!uninstalling}
        title={t('musicPlugins.uninstallTitle', { name: uninstalling?.name ?? '' })}
        message={t('musicPlugins.uninstallMessage')}
        confirmLabel={t('musicPlugins.uninstall')}
        busy={!!busy}
        error={errorFor(uninstallKey) ?? null}
        onConfirm={() => void confirmUninstall()}
        onCancel={() => { setUninstalling(null); setFailure(null); }}
      />
    </div>
  );
}
