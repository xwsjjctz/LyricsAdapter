import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { refreshMusicPlugins, updateMusicPlugins, useMusicPlugins } from '@/stores/musicPluginStore';
import type { MusicPluginCatalogEntry, MusicPluginInfo } from '@/shared/musicPlugin';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';
import PluginConfiguration from './PluginConfiguration';
import PluginTranslationSettings from './PluginTranslationSettings';
import PluginUpdateControls from './PluginUpdateControls';
import { usePluginUpdates } from '@/hooks/usePluginUpdates';

export default function MusicPluginManager({ theme }: { theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { plugins, error: loadError } = useMusicPlugins();
  const { updates, error: updateError, setUpdates } = usePluginUpdates();
  const [catalog, setCatalog] = useState<MusicPluginCatalogEntry[]>([]);
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const api = getDesktopAPI();
  const describe = (reason: unknown) => /net::ERR_|TimeoutError|fetch failed/.test(String(reason)) ? t('musicPlugins.networkError') : String(reason);
  useEffect(() => {
    let mounted = true;
    setLoadingCatalog(true); setError('');
    void (api?.musicPluginCatalog?.() ?? Promise.resolve([])).then(value => {
      if (mounted) setCatalog(value);
    }).catch(reason => { if (mounted) setError(describe(reason)); })
      .finally(() => { if (mounted) setLoadingCatalog(false); });
    void (api?.musicPluginDirectory?.() ?? Promise.resolve('')).then(value => {
      if (mounted) setDirectory(value);
    }).catch(reason => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; };
  }, [api, reload]);

  const change = async (operation: () => Promise<MusicPluginInfo[] | null | void>) => {
    setBusy(true); setError('');
    try { const value = await operation(); if (value) updateMusicPlugins(value); }
    catch (reason) { setError(describe(reason)); await refreshMusicPlugins(); }
    finally { setBusy(false); }
  };
  const { colors } = theme;
  return (
    <div className="space-y-5" data-testid="music-plugin-manager">
      <section className="r-card border p-4 space-y-3" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium" style={{ color: colors.textPrimary }}>{t('musicPlugins.title')}</h2>
          <Button size="sm" disabled={busy || !api} onClick={() => void change(() => api!.musicPluginInstall!())}>{t('musicPlugins.install')}</Button>
        </div>
        <p className="text-xs" style={{ color: colors.textSecondary }}>{t('musicPlugins.description')}</p>
        <div className="text-xs space-y-2" style={{ color: colors.textSecondary }}>
          <p>{t('musicPlugins.directory')}</p>
          <p className="break-all select-text" data-testid="plugin-directory">{directory || t('musicPlugins.desktopOnly')}</p>
          <Button size="sm" disabled={busy || !directory} onClick={() => void change(() => api!.musicPluginOpenDirectory!())}>{t('musicPlugins.openDirectory')}</Button>
        </div>
      </section>
      <PluginTranslationSettings theme={theme} />
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium" style={{ color: colors.textPrimary }}>{t('musicPlugins.available')}</h2>
          <Button size="sm" disabled={loadingCatalog || busy || !api} onClick={() => setReload(value => value + 1)}>{t('musicPlugins.refresh')}</Button>
        </div>
        {loadingCatalog && <p className="text-xs" role="status">{t('musicPlugins.loading')}</p>}
        {catalog.map(item => {
          const installed = plugins.find(plugin => plugin.id === item.id);
          return (
            <div key={item.id} data-testid={`official-plugin-${item.id}`} className="r-card border p-4 flex items-center justify-between gap-4" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
              <div className="text-xs space-y-1">
                <p className="font-medium" style={{ color: colors.textPrimary }}>{item.name}</p>
                <p style={{ color: colors.textMuted }}>{item.version ? t('musicPlugins.officialVersion', { version: item.version }) : t('musicPlugins.unreleased')}</p>
              </div>
              <Button size="sm" disabled={busy || !!installed || !item.version || !api} onClick={() => void change(() => api!.musicPluginDownload!(item.id))}>
                {busy ? t('musicPlugins.working') : t(installed ? 'musicPlugins.installed' : 'musicPlugins.download')}
              </Button>
            </div>
          );
        })}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium" style={{ color: colors.textPrimary }}>{t('musicPlugins.installedTitle')}</h2>
          <Button size="sm" disabled={busy || !api || !plugins.length || updates.some(info => info.status === 'checking' || info.status === 'updating')}
            onClick={() => void change(async () => { setUpdates(await api!.pluginCheckUpdates!()); })}>{t('pluginUpdates.check')}</Button>
        </div>
        {!plugins.length && <p className="text-xs" style={{ color: colors.textSecondary }}>{t('musicPlugins.empty')}</p>}
        {plugins.map(plugin => {
          const update = updates.find(info => info.id === plugin.id);
          return (
            <div key={plugin.id} data-testid={`installed-plugin-${plugin.id}`} className="r-card border p-4 flex flex-wrap items-center justify-between gap-3" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
              <div className="min-w-0 text-xs space-y-1" style={{ color: colors.textPrimary }}>
                <p>{plugin.name} · {plugin.version}</p>
                <p style={{ color: colors.textSecondary }}>{t(plugin.enabled ? 'musicPlugins.enabled' : 'musicPlugins.disabled')}</p>
                {plugin.restartRequired && <p role="status">{t('musicPlugins.restart')}</p>}
                {plugin.error && <p role="alert">{plugin.error}</p>}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Button size="sm" disabled={busy || !api?.musicPluginSetEnabled}
                  aria-label={t(plugin.enabled ? 'musicPlugins.disablePlugin' : 'musicPlugins.enablePlugin', { name: plugin.name })}
                  onClick={() => void change(() => api!.musicPluginSetEnabled!(plugin.id, !plugin.enabled))}>
                  {t(plugin.enabled ? 'musicPlugins.disable' : 'musicPlugins.enable')}
                </Button>
                <Button size="sm" disabled={busy || !api} onClick={() => void change(() => api!.musicPluginUninstall!(plugin.id))}>{t('musicPlugins.uninstall')}</Button>
              </div>
              {plugin.enabled && !plugin.error && plugin.platform?.contributes.configuration && <PluginConfiguration plugin={plugin} theme={theme} />}
              {update && <PluginUpdateControls info={update} theme={theme} busy={busy}
                onUpdate={() => void change(() => api!.pluginUpdate!(plugin.id))}
                onSetSource={source => void change(async () => { setUpdates(await api!.pluginSetUpdateSource!(plugin.id, source)); setUpdates(await api!.pluginCheckUpdates!()); })} />}
            </div>
          );
        })}
      </section>
      {(error || loadError || updateError) && <p className="text-xs" role="alert" style={{ color: colors.textPrimary }}>{error || loadError || updateError}</p>}
      <a href="https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins" target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: colors.primary }}>{t('musicPlugins.repository')}</a>
    </div>
  );
}
