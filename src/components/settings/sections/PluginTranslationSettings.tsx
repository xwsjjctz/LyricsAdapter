import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { useMusicPlugins } from '@/stores/musicPluginStore';
import { useTranslationPreference, setTranslationPreference } from '@/stores/pluginTranslationStore';
import type { PluginProviderInfo } from '@/shared/plugin';
import type { SettingsTheme } from '../shared';

export default function PluginTranslationSettings({ theme }: { theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { plugins } = useMusicPlugins();
  const preference = useTranslationPreference();
  const [providers, setProviders] = useState<PluginProviderInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void getDesktopAPI()?.pluginProviders?.('lyrics.translation').then(list => { if (alive) setProviders(list); })
      .catch(error => { if (alive) setError(String(error)); });
    return () => { alive = false; };
  }, [plugins]);
  const change = async (key: 'provider' | 'language', value: string) => {
    setBusy(true); setError('');
    try { await setTranslationPreference(key, value); } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  if (!providers.length && !preference.provider) return null;
  return <section className="r-card border p-4 space-y-3 text-xs" data-testid="plugin-translation-settings"
    style={{ color: theme.colors.textPrimary, backgroundColor: theme.colors.backgroundCard, borderColor: theme.colors.borderLight }}>
    <h2 className="font-medium">{t('plugins.translationTitle')}</h2>
    <p style={{ color: theme.colors.textSecondary }}>{t('plugins.translationDescription')}</p>
    <label className="flex items-center gap-3"><span>{t('plugins.translationProvider')}</span>
      <select aria-label={t('plugins.translationProvider')} className="rounded border p-1 bg-transparent" disabled={busy || !preference.loaded}
        value={providers.some(p => p.key === preference.provider) ? preference.provider : ''} onChange={event => void change('provider', event.target.value)}>
        <option value="">{t('plugins.translationOff')}</option>
        {providers.map(provider => <option key={provider.key} value={provider.key}>{provider.name}</option>)}
      </select>
    </label>
    <label className="flex items-center gap-3"><span>{t('plugins.translationLanguage')}</span>
      <select aria-label={t('plugins.translationLanguage')} className="rounded border p-1 bg-transparent" disabled={busy || !preference.loaded}
        value={preference.language} onChange={event => void change('language', event.target.value)}>
        <option value="zh">中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option>
      </select>
    </label>
    {preference.provider && !providers.some(p => p.key === preference.provider) && <p role="status">{t('plugins.translationUnavailable')}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
