import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import type { ConfigurationField, PluginDataInfo } from '@/shared/plugin';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { updateMusicPlugins } from '@/stores/musicPluginStore';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';

type Value = string | boolean | number;
const EMPTY_INFO: PluginDataInfo = { configuredSecrets: [], cacheEntries: 0, cacheBytes: 0 };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

interface FieldProps {
  field: ConfigurationField;
  value: Value;
  busy: boolean;
  secretConfigured: boolean;
  onChange: (value: Value) => void;
}

function ConfigurationInput({ field, value, busy, secretConfigured, onChange }: FieldProps) {
  const { t } = useTranslation();
  const className = 'rounded border p-1 bg-transparent';
  if (field.enum) {
    return <select aria-label={field.title} value={String(value)} disabled={busy} className={className}
      onChange={event => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)}>
      {field.enum.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
    </select>;
  }
  if (field.type === 'boolean') {
    return <input type="checkbox" aria-label={field.title} checked={Boolean(value)} disabled={busy} onChange={event => onChange(event.target.checked)} />;
  }
  if (field.format === 'secret') {
    // The stored secret never reaches the renderer; an empty input keeps it.
    return <input className={className} type="password" autoComplete="off" aria-label={field.title} disabled={busy} value={String(value)}
      placeholder={t(secretConfigured ? 'plugins.secretConfigured' : 'plugins.secretEmpty')} onChange={event => onChange(event.target.value)} />;
  }
  return <input className={className} type={field.type === 'number' ? 'number' : field.format === 'endpoint' ? 'url' : 'text'} aria-label={field.title}
    disabled={busy} value={String(value)} onChange={event => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)} />;
}

export default function PluginConfiguration({ plugin, theme }: { plugin: MusicPluginInfo; theme: SettingsTheme }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, Value>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [clearedSecrets, setClearedSecrets] = useState<readonly string[]>([]);
  const [info, setInfo] = useState<PluginDataInfo>(EMPTY_INFO);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = Object.entries(plugin.platform?.contributes.configuration ?? {});
  useEffect(() => {
    let alive = true;
    const api = getDesktopAPI();
    void api?.pluginConfiguration?.(plugin.id).then(values => { if (alive) setValues(values); })
      .catch(error => { if (alive) setError(String(error)); });
    void api?.pluginDataInfo?.(plugin.id).then(info => { if (alive) setInfo(info); })
      .catch(error => { if (alive) setError(String(error)); });
    return () => { alive = false; };
  }, [plugin.id, plugin.revision]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const api = getDesktopAPI();
      if (!api?.pluginSetConfiguration) throw new Error('Plugin platform is unavailable');
      for (const [key, field] of fields) {
        if (field.format !== 'secret') await api.pluginSetConfiguration(plugin.id, key, values[key] ?? field.default);
        else if (secrets[key]) await api.pluginSetConfiguration(plugin.id, key, secrets[key]);
        else if (clearedSecrets.includes(key)) await api.pluginSetConfiguration(plugin.id, key, '');
      }
      setSecrets({}); setClearedSecrets([]);
      if (api.musicPluginList) updateMusicPlugins(await api.musicPluginList());
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  const clearCache = async () => {
    setBusy(true); setError('');
    try {
      const api = getDesktopAPI();
      if (!api?.pluginClearCache) throw new Error('Plugin platform is unavailable');
      await api.pluginClearCache(plugin.id);
      if (api.musicPluginList) updateMusicPlugins(await api.musicPluginList());
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  const secretConfigured = (key: string) => info.configuredSecrets.includes(key) && !clearedSecrets.includes(key);
  return <div className="w-full space-y-2 text-xs" style={{ color: theme.colors.textPrimary }}>
    {fields.map(([key, field]) => <div key={key} className="space-y-1">
      <label className="flex flex-wrap items-center gap-3">
        <span>{field.title}</span>
        <ConfigurationInput field={field} busy={busy} secretConfigured={secretConfigured(key)}
          value={field.format === 'secret' ? secrets[key] ?? '' : values[key] ?? field.default}
          onChange={value => field.format === 'secret'
            ? setSecrets({ ...secrets, [key]: String(value) })
            : setValues({ ...values, [key]: value })} />
        {field.format === 'secret' && secretConfigured(key) && <Button size="sm" disabled={busy}
          aria-label={t('plugins.clearSecretLabel', { name: field.title })}
          onClick={() => { setClearedSecrets([...clearedSecrets, key]); setSecrets({ ...secrets, [key]: '' }); }}>{t('plugins.clearSecret')}</Button>}
      </label>
      {field.description && <p style={{ color: theme.colors.textSecondary }}>{field.description}</p>}
    </div>)}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy || !fields.length} onClick={() => void save()}>{t('plugins.saveConfiguration')}</Button>
      <Button size="sm" disabled={busy || !info.cacheEntries} onClick={() => void clearCache()}>{t('plugins.clearCache')}</Button>
      <span style={{ color: theme.colors.textSecondary }}>{t('plugins.cacheSummary', { count: info.cacheEntries, size: formatBytes(info.cacheBytes) })}</span>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
