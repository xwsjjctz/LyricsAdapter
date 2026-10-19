import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import type { PluginUpdateInfo, PluginUpdateSource } from '@/shared/pluginUpdate';
import { sourceLogin } from '@/services/musicSources';
import type { SettingsTheme } from '../shared';
import { useSourceSignedIn } from '../hooks/useSourceLogin';
import Button from '../../ui/Button';
import SettingsMessage from '../SettingsMessage';
import { Switch } from '../../ui';
import PluginConfiguration from './PluginConfiguration';
import PluginUpdateControls from './PluginUpdateControls';
import SourceLoginSection from './SourceLoginSection';
import TranslationLanguageField, { translationProviderOf } from './TranslationLanguageField';

interface InstalledPluginCardProps {
  theme: SettingsTheme;
  plugin: MusicPluginInfo;
  update: PluginUpdateInfo | undefined;
  /** The running operation, if any; every action waits for it. */
  busy: string | null;
  available: boolean;
  /** Why the last enable or update-source change for this plugin failed. */
  error?: string | undefined;
  onSetEnabled: (plugin: MusicPluginInfo, enabled: boolean) => void;
  onUninstall: (plugin: MusicPluginInfo) => void;
  onUpdate: (id: string) => void;
  onSetUpdateSource: (id: string, source: PluginUpdateSource | null) => void;
}

/** A music source's sign-in state for the card's one-line summary. */
function SignInSummary({ source }: { source: string }) {
  const { t } = useTranslation();
  const signedIn = useSourceSignedIn(source);
  return <>{t(signedIn ? 'musicPlugins.signedIn' : 'musicPlugins.signedOut')}</>;
}

/**
 * One installed plugin: name, state and the main actions on one line. Its settings open
 * inside the card: a music source's sign-in, a translator's target language, the plugin's
 * own configuration and its update source.
 */
export default function InstalledPluginCard({
  theme, plugin, update, busy, available, error, onSetEnabled, onUninstall, onUpdate, onSetUpdateSource,
}: InstalledPluginCardProps) {
  const { t } = useTranslation();
  const { colors } = theme;
  const [open, setOpen] = useState(false);
  const usable = plugin.enabled && !plugin.error;
  const isSource = usable && plugin.capabilities.includes('search');
  const signsIn = isSource && sourceLogin(plugin.id) !== 'none';
  const configurable = usable && !!plugin.platform?.contributes.configuration;
  const translates = usable && !!translationProviderOf(plugin);
  const detailsId = `plugin-details-${plugin.id}`;
  // The switch shows whether the plugin is on; the summary adds only what it does not say.
  const summary: ReactNode[] = [];
  if (!plugin.enabled) summary.push(t('musicPlugins.disabled'));
  if (signsIn) summary.push(<SignInSummary source={plugin.id} />);
  if (update?.status === 'available') summary.push(t('musicPlugins.updateAvailable', { version: update.targetVersion }));
  return (
    <div data-testid={`installed-plugin-${plugin.id}`} className="r-card border p-4 space-y-3" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-xs space-y-1" style={{ color: colors.textPrimary }}>
          <p>{plugin.name} · {plugin.version}</p>
          {summary.length > 0 && (
            <p style={{ color: colors.textSecondary }}>
              {summary.map((part, index) => <Fragment key={index}>{index > 0 && ' · '}{part}</Fragment>)}
            </p>
          )}
          {plugin.restartRequired && <p role="status">{t('musicPlugins.restart')}</p>}
          {plugin.error && <SettingsMessage tone="error">{plugin.error}</SettingsMessage>}
          {error && <SettingsMessage tone="error">{error}</SettingsMessage>}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {plugin.origin === 'installed' && (
            <Button size="sm" disabled={!!busy || !available} onClick={() => onUninstall(plugin)}>{t('musicPlugins.uninstall')}</Button>
          )}
          {(isSource || configurable || translates || update) && (
            <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={detailsId}
              aria-label={t('musicPlugins.settingsFor', { name: plugin.name })} onClick={() => setOpen(value => !value)}>
              {t('musicPlugins.settings')}
              <span className="material-symbols-rounded text-base" aria-hidden="true">{open ? 'expand_less' : 'expand_more'}</span>
            </Button>
          )}
          <Switch checked={plugin.enabled} label={t('musicPlugins.enablePlugin', { name: plugin.name })}
            disabled={!!busy || !available} onChange={enabled => onSetEnabled(plugin, enabled)} />
        </div>
      </div>
      {open && (
        <div id={detailsId} className="space-y-4 pt-3 border-t" style={{ borderColor: colors.borderLight }}>
          {/* Mounted only while open, so QR login polls only while someone is looking. */}
          {isSource && <SourceLoginSection source={plugin.id} theme={theme} />}
          {translates && <TranslationLanguageField plugin={plugin} theme={theme} />}
          {configurable && <PluginConfiguration plugin={plugin} theme={theme} />}
          {update && <PluginUpdateControls info={update} theme={theme} busy={!!busy}
            onUpdate={() => onUpdate(plugin.id)}
            onSetSource={source => onSetUpdateSource(plugin.id, source)} />}
        </div>
      )}
    </div>
  );
}
