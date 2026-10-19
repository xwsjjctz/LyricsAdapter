import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { refreshMusicPlugins, updateMusicPlugins, useMusicPlugins } from '@/stores/musicPluginStore';
import type { MusicPluginCatalogEntry, MusicPluginInfo } from '@/shared/musicPlugin';
import type { SettingsTheme } from '../shared';
import ConfirmDialog from '../../ConfirmDialog';
import Button from '../../ui/Button';
import InstalledPluginList from './InstalledPluginList';
import PluginCatalog, { downloadKey } from './PluginCatalog';
import { usePluginUpdates } from '@/hooks/usePluginUpdates';

/** One page: installed plugins first, then the official ones still to install. */
export default function MusicPluginManager({ theme }: { theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { plugins, error: loadError } = useMusicPlugins();
  const { updates, error: updateError, setUpdates } = usePluginUpdates();
  const [catalog, setCatalog] = useState<MusicPluginCatalogEntry[]>([]);
  const [directory, setDirectory] = useState('');
  // One operation at a time; the key names it so only its own button reads "working".
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [uninstalling, setUninstalling] = useState<MusicPluginInfo | null>(null);
  const api = getDesktopAPI();
  const describe = (reason: unknown) => /net::ERR_|TimeoutError|fetch failed/.test(String(reason)) ? t('musicPlugins.networkError') : String(reason);
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
    }).catch(reason => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; };
  }, [api]);

  useEffect(() => {
    if (!seen) return;
    let mounted = true;
    setLoadingCatalog(true); setCatalogFailed(false); setError('');
    void (api?.musicPluginCatalog?.() ?? Promise.resolve([])).then(value => {
      if (mounted) setCatalog(value);
    }).catch(reason => { if (mounted) { setCatalogFailed(true); setError(describe(reason)); } })
      .finally(() => { if (mounted) setLoadingCatalog(false); });
    return () => { mounted = false; };
  }, [api, reload, seen]);

  const change = async (key: string, operation: () => Promise<MusicPluginInfo[] | null | void>) => {
    setBusy(key); setError('');
    try { const value = await operation(); if (value) updateMusicPlugins(value); }
    catch (reason) { setError(describe(reason)); await refreshMusicPlugins(); }
    finally { setBusy(null); }
  };
  const confirmUninstall = async () => {
    if (!uninstalling) return;
    await change(`uninstall:${uninstalling.id}`, () => api!.musicPluginUninstall!(uninstalling.id));
    setUninstalling(null);
  };
  const { colors } = theme;
  return (
    <div ref={rootRef} className="space-y-6" data-testid="music-plugin-manager">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs" style={{ color: colors.textSecondary }}>{t('musicPlugins.description')}</p>
        <Button size="sm" disabled={!!busy || !api} onClick={() => void change('install', () => api!.musicPluginInstall!())}>{t('musicPlugins.install')}</Button>
      </div>
      <InstalledPluginList theme={theme} plugins={plugins} updates={updates} busy={busy} available={!!api}
        onCheckUpdates={() => void change('updates', async () => { setUpdates(await api!.pluginCheckUpdates!()); })}
        onSetEnabled={(plugin, enabled) => void change(`enable:${plugin.id}`, () => api!.musicPluginSetEnabled!(plugin.id, enabled))}
        onUninstall={setUninstalling}
        onUpdate={id => void change(`update:${id}`, () => api!.pluginUpdate!(id))}
        onSetUpdateSource={(id, source) => void change(`source:${id}`, async () => {
          setUpdates(await api!.pluginSetUpdateSource!(id, source)); setUpdates(await api!.pluginCheckUpdates!());
        })} />
      <PluginCatalog theme={theme} catalog={notInstalled} loading={loadingCatalog} failed={catalogFailed} busy={busy} available={!!api}
        onRefresh={() => setReload(value => value + 1)}
        onDownload={id => void change(downloadKey(id), () => api!.musicPluginDownload!(id))} />
      {(error || loadError || updateError) && <p className="text-xs" role="alert" style={{ color: colors.textPrimary }}>{error || loadError || updateError}</p>}
      <section className="text-xs space-y-2" style={{ color: colors.textSecondary }}>
        <p>{t('musicPlugins.directory')}</p>
        <p className="break-all select-text" data-testid="plugin-directory">{directory || t('musicPlugins.desktopOnly')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={!!busy || !directory} onClick={() => void change('directory', () => api!.musicPluginOpenDirectory!())}>{t('musicPlugins.openDirectory')}</Button>
          <a href="https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins" target="_blank" rel="noreferrer" className="underline" style={{ color: colors.primary }}>{t('musicPlugins.repository')}</a>
        </div>
      </section>
      <ConfirmDialog
        isOpen={!!uninstalling}
        title={t('musicPlugins.uninstallTitle', { name: uninstalling?.name ?? '' })}
        message={t('musicPlugins.uninstallMessage')}
        confirmLabel={t('musicPlugins.uninstall')}
        busy={!!busy}
        onConfirm={() => void confirmUninstall()}
        onCancel={() => setUninstalling(null)}
      />
    </div>
  );
}
