import { useTranslation } from 'react-i18next';
import type { MusicPluginCatalogEntry } from '@/shared/musicPlugin';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';

interface PluginCatalogProps {
  theme: SettingsTheme;
  /** Official plugins that are not installed yet. */
  catalog: MusicPluginCatalogEntry[];
  loading: boolean;
  /** The catalog could not be fetched; the manager shows why. */
  failed: boolean;
  /** The running operation, if any; only its own button reads "working". */
  busy: string | null;
  available: boolean;
  onRefresh: () => void;
  onDownload: (id: string) => void;
}

export const downloadKey = (id: string) => `download:${id}`;

/** Official plugins still to install; an installed one moves to the list above. */
export default function PluginCatalog({ theme, catalog, loading, failed, busy, available, onRefresh, onDownload }: PluginCatalogProps) {
  const { t } = useTranslation();
  const { colors } = theme;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium" style={{ color: colors.textPrimary }}>{t('musicPlugins.available')}</h3>
        <Button size="sm" disabled={loading || !!busy || !available} onClick={onRefresh}>{t('musicPlugins.refresh')}</Button>
      </div>
      {loading && <p className="text-xs" role="status">{t('musicPlugins.loading')}</p>}
      {!loading && !failed && !catalog.length && <p className="text-xs" style={{ color: colors.textSecondary }}>{t('musicPlugins.allInstalled')}</p>}
      {catalog.map(item => (
        <div key={item.id} data-testid={`official-plugin-${item.id}`} className="r-card border p-4 flex items-center justify-between gap-4" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
          <div className="min-w-0 text-xs space-y-1">
            <p className="font-medium" style={{ color: colors.textPrimary }}>{item.name}</p>
            <p style={{ color: colors.textMuted }}>
              {t(item.kind === 'lyrics.translation' ? 'musicPlugins.kindTranslation' : 'musicPlugins.kindMusicSource')}
              {' · '}{item.version ? t('musicPlugins.officialVersion', { version: item.version }) : t('musicPlugins.unreleased')}
            </p>
            {item.description && <p style={{ color: colors.textSecondary }}>{item.description}</p>}
          </div>
          <Button size="sm" disabled={!!busy || !item.version || !available} onClick={() => onDownload(item.id)}>
            {busy === downloadKey(item.id) ? t('musicPlugins.working') : t('musicPlugins.download')}
          </Button>
        </div>
      ))}
    </section>
  );
}
