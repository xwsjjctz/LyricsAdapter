import { useTranslation } from 'react-i18next';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import type { PluginUpdateInfo, PluginUpdateSource } from '@/shared/pluginUpdate';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';
import InstalledPluginCard from './InstalledPluginCard';

interface InstalledPluginListProps {
  theme: SettingsTheme;
  plugins: MusicPluginInfo[];
  updates: PluginUpdateInfo[];
  /** The running operation, if any; every action waits for it. */
  busy: string | null;
  available: boolean;
  onCheckUpdates: () => void;
  onSetEnabled: (plugin: MusicPluginInfo, enabled: boolean) => void;
  onUninstall: (plugin: MusicPluginInfo) => void;
  onUpdate: (id: string) => void;
  onSetUpdateSource: (id: string, source: PluginUpdateSource | null) => void;
}

/** Installed plugins as one-line cards whose settings open one level deep. */
export default function InstalledPluginList({
  theme, plugins, updates, busy, available, onCheckUpdates, ...cardActions
}: InstalledPluginListProps) {
  const { t } = useTranslation();
  const { colors } = theme;
  const checking = updates.some(info => info.status === 'checking' || info.status === 'updating');
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium" style={{ color: colors.textPrimary }}>{t('musicPlugins.installedTitle')}</h3>
        {plugins.length > 0 && (
          <Button size="sm" disabled={!!busy || !available || checking} onClick={onCheckUpdates}>{t('pluginUpdates.check')}</Button>
        )}
      </div>
      {!plugins.length && <p className="text-xs" style={{ color: colors.textSecondary }}>{t('musicPlugins.empty')}</p>}
      {plugins.map(plugin => (
        <InstalledPluginCard key={plugin.id} theme={theme} plugin={plugin} update={updates.find(info => info.id === plugin.id)}
          busy={busy} available={available} {...cardActions} />
      ))}
    </section>
  );
}
