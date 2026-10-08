import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginUpdateInfo, PluginUpdateSource, PluginUpdateChannel } from '@/shared/pluginUpdate';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';

interface Props {
  info: PluginUpdateInfo;
  theme: SettingsTheme;
  busy: boolean;
  onUpdate(): void;
  onSetSource(source: PluginUpdateSource | null): void;
}
export default function PluginUpdateControls({ info, theme, busy, onUpdate, onSetSource }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<PluginUpdateSource['kind'] | 'none'>(info.source?.kind ?? 'none');
  const [value, setValue] = useState('');
  const [channel, setChannel] = useState<PluginUpdateChannel>('stable');
  const sourceKey = JSON.stringify(info.source);
  useEffect(() => {
    const source = JSON.parse(sourceKey) as PluginUpdateSource | null;
    setKind(source?.kind ?? 'none'); setChannel(source?.channel ?? 'stable');
    setValue(source?.kind === 'github' ? source.repository : source?.kind === 'manifest' ? source.url : '');
  }, [sourceKey]);
  const save = () => {
    const input = value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '').replace(/\.git$/, '');
    onSetSource(kind === 'none' ? null : kind === 'official' ? { kind, channel: 'stable' }
      : kind === 'github' ? { kind, repository: input, channel } : { kind, url: value.trim(), channel });
  };
  return <div className="w-full text-xs space-y-2" data-testid={`plugin-update-${info.id}`} style={{ color: theme.colors.textSecondary }}>
    <div className="flex flex-wrap items-center gap-3">
      <p role="status">{info.status === 'available' ? t('pluginUpdates.available', { current: info.currentVersion, next: info.targetVersion }) : t(`pluginUpdates.${info.status}`)}</p>
      {info.status === 'available' && <Button size="sm" disabled={busy} onClick={onUpdate}>{t('pluginUpdates.update')}</Button>}
      {info.status === 'error' && info.targetVersion && <Button size="sm" disabled={busy} onClick={onUpdate}>{t('pluginUpdates.retry')}</Button>}
    </div>
    {info.status === 'available' && info.latestVersion !== info.targetVersion && <p>{t('pluginUpdates.newerIncompatible', { version: info.latestVersion })}</p>}
    {info.notes && <p className="whitespace-pre-wrap break-words max-h-28 overflow-y-auto">{info.notes}</p>}
    {info.error && <p role="alert">{info.error}</p>}
    <details>
      <summary className="cursor-pointer">{t('pluginUpdates.source')}</summary>
      <div className="mt-2 space-y-2">
        <label className="flex flex-wrap items-center gap-2">
          <span>{t('pluginUpdates.sourceType')}</span>
          <select aria-label={t('pluginUpdates.sourceType')} className="rounded border p-1 bg-transparent" value={kind} disabled={busy} onChange={event => setKind(event.target.value as typeof kind)}>
            <option value="none">{t('pluginUpdates.none')}</option>
            <option value="github">GitHub Releases</option>
            <option value="manifest">{t('pluginUpdates.feed')}</option>
            {(info.id === 'qq' || info.id === 'netease') && <option value="official">{t('pluginUpdates.official')}</option>}
          </select>
        </label>
        {(kind === 'github' || kind === 'manifest') && <>
          <label className="flex flex-wrap items-center gap-2">
            <span>{t(kind === 'github' ? 'pluginUpdates.repository' : 'pluginUpdates.feedUrl')}</span>
            <input aria-label={t(kind === 'github' ? 'pluginUpdates.repository' : 'pluginUpdates.feedUrl')} className="rounded border p-1 bg-transparent flex-1 min-w-48" value={value} disabled={busy}
              placeholder={kind === 'github' ? 'owner/repository' : 'https://example.com/plugins.update.json'} onChange={event => setValue(event.target.value)} />
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span>{t('pluginUpdates.channel')}</span>
            <select aria-label={t('pluginUpdates.channel')} className="rounded border p-1 bg-transparent" value={channel} disabled={busy} onChange={event => setChannel(event.target.value as PluginUpdateChannel)}>
              <option value="stable">{t('pluginUpdates.stable')}</option><option value="prerelease">{t('pluginUpdates.prerelease')}</option>
            </select>
          </label>
          <p>{t('pluginUpdates.sourceHint')}</p>
        </>}
        <Button size="sm" disabled={busy || ((kind === 'github' || kind === 'manifest') && !value.trim())} onClick={save}>{t('pluginUpdates.saveSource')}</Button>
      </div>
    </details>
  </div>;
}
