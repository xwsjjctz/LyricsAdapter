import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import { effectiveTranslationLanguage, languageDisplayName, translationLanguages } from '@/services/pluginTranslation';
import { setTranslationLanguage, useTranslationPreference } from '@/stores/pluginTranslationStore';
import type { SettingsTheme } from '../shared';
import SettingsMessage from '../SettingsMessage';

/** The plugin's first lyrics.translation provider, which Focus Mode translates with. */
export function translationProviderOf(plugin: MusicPluginInfo) {
  return plugin.platform?.contributes.providers.find(provider => provider.type === 'lyrics.translation');
}

/**
 * Target language for a translation plugin, shown with its other settings. The choice is
 * stored by the host, not the plugin, and applies as it changes.
 */
export default function TranslationLanguageField({ plugin, theme }: { plugin: MusicPluginInfo; theme: SettingsTheme }) {
  const { t } = useTranslation();
  const preference = useTranslationPreference();
  const [error, setError] = useState('');
  const provider = translationProviderOf(plugin);
  const language = effectiveTranslationLanguage(provider, preference.language);
  const change = async (value: string) => {
    setError('');
    try { await setTranslationLanguage(value); } catch (reason) { setError(String(reason)); }
  };
  return <div className="space-y-1 text-xs" style={{ color: theme.colors.textPrimary }}>
    <label className="flex flex-wrap items-center justify-between gap-3">
      <span>{t('plugins.translationLanguage')}</span>
      <select aria-label={t('plugins.translationLanguage')} className="settings-field" disabled={!preference.loaded}
        value={language} onChange={event => void change(event.target.value)}>
        {translationLanguages(provider).map(tag => <option key={tag} value={tag}>{languageDisplayName(tag)}</option>)}
      </select>
    </label>
    {error && <SettingsMessage tone="error">{error}</SettingsMessage>}
  </div>;
}
