import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { updateMusicPlugins } from '@/stores/musicPluginStore';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';

export default function PluginConfiguration({ plugin, theme }: { plugin: MusicPluginInfo; theme: SettingsTheme }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string | boolean | number>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void getDesktopAPI()?.pluginConfiguration?.(plugin.id).then(values => { if (alive) setValues(values); })
      .catch(error => { if (alive) setError(String(error)); });
    return () => { alive = false; };
  }, [plugin.id, plugin.revision]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const api = getDesktopAPI();
      if (!api?.pluginSetConfiguration) throw new Error('Plugin platform is unavailable');
      for (const [key, value] of Object.entries(values)) await api.pluginSetConfiguration(plugin.id, key, value);
      if (api.musicPluginList) updateMusicPlugins(await api.musicPluginList());
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <div className="w-full space-y-2 text-xs" style={{ color: theme.colors.textPrimary }}>
    {Object.entries(plugin.platform?.contributes.configuration ?? {}).map(([key, field]) => <label key={key} className="flex flex-wrap items-center gap-3">
      <span>{field.title}</span>
      {field.enum ? <select aria-label={field.title} value={String(values[key] ?? field.default)} disabled={busy}
        className="rounded border p-1 bg-transparent" onChange={event => setValues({ ...values, [key]: field.type === 'number' ? Number(event.target.value) : event.target.value })}>
        {field.enum.map(value => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
      </select> : field.type === 'boolean' ? <input type="checkbox" checked={Boolean(values[key] ?? field.default)} disabled={busy}
        onChange={event => setValues({ ...values, [key]: event.target.checked })} />
      : <input className="rounded border p-1 bg-transparent" type={field.type === 'number' ? 'number' : 'text'} disabled={busy}
        value={String(values[key] ?? field.default)} onChange={event => setValues({ ...values, [key]: field.type === 'number' ? Number(event.target.value) : event.target.value })} />}
    </label>)}
    <Button size="sm" disabled={busy || !Object.keys(values).length} onClick={() => void save()}>{t('plugins.saveConfiguration')}</Button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
