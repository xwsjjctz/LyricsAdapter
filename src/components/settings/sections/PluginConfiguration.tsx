import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MusicPluginInfo } from '@/shared/musicPlugin';
import type { ConfigurationField, PluginDataInfo } from '@/shared/plugin';
import { getDesktopAPI } from '@/services/desktopAdapter';
import { updateMusicPlugins } from '@/stores/musicPluginStore';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';
import { Switch } from '../../ui';
import SettingsMessage from '../SettingsMessage';

type Value = string | boolean | number;
const EMPTY_INFO: PluginDataInfo = { configuredSecrets: [], cacheEntries: 0, cacheBytes: 0 };
const INPUT_CLASS = 'settings-field';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

interface FieldProps {
  field: ConfigurationField;
  value: Value;
  /** Stores the value; resolves false when the host rejects it. */
  onCommit: (value: Value) => Promise<boolean>;
}

/**
 * Typed text applies when the field is left or Enter is pressed, and when the
 * sheet closes: closing removes the input without a blur event.
 */
function TextField({ field, value, onCommit }: FieldProps) {
  const [draft, setDraft] = useState(String(value));
  const flush = useRef<() => void>(() => {});
  useEffect(() => setDraft(String(value)), [value]);

  const parse = (text: string): Value | null => {
    if (field.type !== 'number') return text;
    const number = Number(text);
    return text.trim() && Number.isFinite(number) ? number : null;
  };
  const commit = () => {
    const next = parse(draft);
    if (next === null) setDraft(String(value));
    else if (next !== value) void onCommit(next);
  };
  flush.current = () => {
    const next = parse(draft);
    if (next !== null && next !== value) void onCommit(next);
  };
  useEffect(() => () => flush.current(), []);

  return <input className={`${INPUT_CLASS} w-full`} type={field.type === 'number' ? 'number' : field.format === 'endpoint' ? 'url' : 'text'}
    aria-label={field.title} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') commit(); }} />;
}

interface SecretFieldProps {
  field: ConfigurationField;
  configured: boolean;
  busy: boolean;
  onCommit: (value: string) => Promise<boolean>;
}

/** The stored secret never reaches the renderer, so a new one is saved explicitly. */
function SecretField({ field, configured, busy, onCommit }: SecretFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const save = async () => { if (draft && await onCommit(draft)) setDraft(''); };
  // One line at any width: the input takes the room, the buttons keep theirs.
  return <div className="flex items-center gap-2">
    <input className={`${INPUT_CLASS} min-w-0 flex-1`} type="password" autoComplete="off" aria-label={field.title} value={draft}
      placeholder={t(configured ? 'plugins.secretConfigured' : 'plugins.secretEmpty')}
      onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); }} />
    <Button size="sm" className="flex-shrink-0" disabled={busy || !draft} aria-label={t('plugins.saveSecretLabel', { name: field.title })}
      onClick={() => void save()}>{t('settingsDialog.save')}</Button>
    {configured && <Button size="sm" className="flex-shrink-0" disabled={busy} aria-label={t('plugins.clearSecretLabel', { name: field.title })}
      onClick={() => void onCommit('')}>{t('plugins.clearSecret')}</Button>}
  </div>;
}

interface ConfigurationInputProps {
  field: ConfigurationField;
  value: Value;
  /** `optimistic` shows the value before the host confirms it. */
  onCommit: (value: Value, optimistic: boolean) => Promise<boolean>;
}

function ConfigurationInput({ field, value, onCommit }: ConfigurationInputProps) {
  if (field.enum) {
    return <select aria-label={field.title} value={String(value)} className={INPUT_CLASS}
      onChange={event => void onCommit(field.type === 'number' ? Number(event.target.value) : event.target.value, true)}>
      {field.enum.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
    </select>;
  }
  if (field.type === 'boolean') {
    return <Switch checked={Boolean(value)} label={field.title} onChange={checked => void onCommit(checked, true)} />;
  }
  // A rejected text value stays in the field to be corrected.
  return <TextField field={field} value={value} onCommit={next => onCommit(next, false)} />;
}

/**
 * Text, URL, number and secret fields stack (label above, input at full width) so long values
 * stay readable in a narrow sheet; choices and switches keep the label-left, control-right row.
 */
const isStacked = (field: ConfigurationField) => field.format === 'secret' || (!field.enum && field.type !== 'boolean');

/** Plugin settings apply as they change; only secrets have a Save step. Shared by both sheets. */
export function usePluginConfiguration(plugin: MusicPluginInfo) {
  const [values, setValues] = useState<Record<string, Value>>({});
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
  // Inputs stay enabled while a write runs, so moving to the next field is never blocked.
  const write = async (key: string, value: Value, optimistic: boolean): Promise<boolean> => {
    const previous = values;
    if (optimistic) setValues(current => ({ ...current, [key]: value }));
    setBusy(true); setError('');
    try {
      const api = getDesktopAPI();
      if (!api?.pluginSetConfiguration) throw new Error('Plugin platform is unavailable');
      await api.pluginSetConfiguration(plugin.id, key, value);
      if (api.musicPluginList) updateMusicPlugins(await api.musicPluginList());
      return true;
    } catch (error) {
      if (optimistic) {
        setValues(current => Object.hasOwn(previous, key)
          ? { ...current, [key]: previous[key]! }
          : Object.fromEntries(Object.entries(current).filter(([name]) => name !== key)));
      }
      setError(String(error));
      return false;
    } finally { setBusy(false); }
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
  return { fields, values, info, error, busy, write, clearCache };
}

export default function PluginConfiguration({ plugin, theme }: { plugin: MusicPluginInfo; theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { fields, values, info, error, busy, write, clearCache } = usePluginConfiguration(plugin);
  return <div className="w-full space-y-2 text-xs" style={{ color: theme.colors.textPrimary }}>
    {fields.map(([key, field]) => {
      const control = field.format === 'secret'
        ? <SecretField field={field} busy={busy} configured={info.configuredSecrets.includes(key)}
          onCommit={value => write(key, value, false)} />
        : <ConfigurationInput field={field} value={values[key] ?? field.default}
          onCommit={(value, optimistic) => write(key, value, optimistic)} />;
      return <div key={key} className="space-y-1.5">
        {isStacked(field)
          ? <><p>{field.title}</p>{control}</>
          : <div className="flex items-center justify-between gap-3"><span className="min-w-0">{field.title}</span>{control}</div>}
        {field.description && <p style={{ color: theme.colors.textMuted }}>{field.description}</p>}
      </div>;
    })}
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy || !info.cacheEntries} onClick={() => void clearCache()}>{t('plugins.clearCache')}</Button>
      <span style={{ color: theme.colors.textSecondary }}>{t('plugins.cacheSummary', { count: info.cacheEntries, size: formatBytes(info.cacheBytes) })}</span>
    </div>
    {error && <SettingsMessage tone="error">{error}</SettingsMessage>}
  </div>;
}
