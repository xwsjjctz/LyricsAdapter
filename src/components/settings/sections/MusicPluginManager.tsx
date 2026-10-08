import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '@/services/desktopAdapter';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';

export default function MusicPluginManager({ theme }: { theme: SettingsTheme }) {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<MusicPluginInfo[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    const api = getDesktopAPI();
    void (api?.musicPluginList?.() ?? Promise.resolve([])).then(value => {
      if (mounted) setPlugins(value);
    }).catch(reason => { if (mounted) setError(String(reason)); })
      .finally(() => { if (mounted) setBusy(false); });
    return () => { mounted = false; };
  }, []);

  const change = async (operation: () => Promise<MusicPluginInfo[] | null | undefined>) => {
    setBusy(true); setError('');
    try {
      const value = await operation();
      if (value) setPlugins(value);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="mb-4 space-y-2" data-testid="music-plugin-manager">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium" style={{ color: theme.colors.textPrimary }}>{t('musicPlugins.title')}</span>
        <Button size="sm" disabled={busy || !getDesktopAPI()} onClick={() => void change(() => getDesktopAPI()?.musicPluginInstall?.() ?? Promise.resolve(null))}>
          {t('musicPlugins.install')}
        </Button>
      </div>
      <p className="text-xs" style={{ color: theme.colors.textSecondary }}>{t('musicPlugins.description')}</p>
      {plugins.map(plugin => (
        <div key={plugin.id} className="flex items-center justify-between gap-3 rounded-lg border p-2" style={{ borderColor: theme.colors.borderLight }}>
          <div className="min-w-0 text-xs" style={{ color: theme.colors.textPrimary }}>
            <span>{plugin.name} · {plugin.version}</span>
            <span className="ml-2" style={{ color: theme.colors.textMuted }}>{t(`musicPlugins.${plugin.origin}`)}</span>
            {plugin.restartRequired && <p className="mt-1" role="status">{t('musicPlugins.restart')}</p>}
            {plugin.error && <p className="mt-1" role="alert">{plugin.error}</p>}
          </div>
          {plugin.origin === 'installed' && (
            <Button size="sm" disabled={busy} onClick={() => void change(() => getDesktopAPI()?.musicPluginUninstall?.(plugin.id) ?? Promise.resolve(null))}>
              {t('musicPlugins.uninstall')}
            </Button>
          )}
          <button type="button" role="switch" aria-checked={plugin.enabled} aria-label={`${t('musicPlugins.toggle')} ${plugin.name}`}
            disabled={busy} className="px-2 py-1 text-xs rounded border disabled:opacity-50"
            style={{ color: theme.colors.textPrimary, borderColor: theme.colors.borderLight }}
            onClick={() => void change(() => getDesktopAPI()?.musicPluginSetEnabled?.(plugin.id, !plugin.enabled) ?? Promise.resolve(null))}>
            {t(plugin.enabled ? 'musicPlugins.enabled' : 'musicPlugins.disabled')}
          </button>
        </div>
      ))}
      {!busy && plugins.length === 0 && <p className="text-xs">{t('musicPlugins.empty')}</p>}
      {error && <p className="text-xs" role="alert" style={{ color: theme.colors.textPrimary }}>{error}</p>}
      <a href="https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins" target="_blank" rel="noreferrer" className="text-xs underline" style={{ color: theme.colors.primary }}>
        {t('musicPlugins.repository')}
      </a>
    </div>
  );
}
