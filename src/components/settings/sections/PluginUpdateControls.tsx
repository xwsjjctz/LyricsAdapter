import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isOfficialMusicSource, type PluginUpdateInfo, type PluginUpdateSource, type PluginUpdateChannel } from '@/shared/pluginUpdate';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';
import SettingsMessage from '../SettingsMessage';

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
    {info.error && <SettingsMessage tone="error">{info.error}</SettingsMessage>}
    {/* Already inside the card's settings area, so the source is shown, not folded again. */}
    <div className="space-y-2">
      <p className="font-medium" style={{ color: theme.colors.textPrimary }}>{t('pluginUpdates.source')}</p>
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">{t('pluginUpdates.sourceType')}</span>
        <select aria-label={t('pluginUpdates.sourceType')} className="settings-field" value={kind} disabled={busy} onChange={event => setKind(event.target.value as typeof kind)}>
          <option value="none">{t('pluginUpdates.none')}</option>
          <option value="github">GitHub Releases</option>
          <option value="manifest">{t('pluginUpdates.feed')}</option>
          {isOfficialMusicSource(info.id) && <option value="official">{t('pluginUpdates.official')}</option>}
        </select>
      </label>
      {(kind === 'github' || kind === 'manifest') && <>
        {/* Like the plugin's own text settings: label above, input at full width. */}
        <label className="flex flex-col gap-1.5">
          <span>{t(kind === 'github' ? 'pluginUpdates.repository' : 'pluginUpdates.feedUrl')}</span>
          <input aria-label={t(kind === 'github' ? 'pluginUpdates.repository' : 'pluginUpdates.feedUrl')} className="settings-field w-full" value={value} disabled={busy}
            placeholder={kind === 'github' ? 'owner/repository' : 'https://example.com/plugins.update.json'} onChange={event => setValue(event.target.value)} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">{t('pluginUpdates.channel')}</span>
          <select aria-label={t('pluginUpdates.channel')} className="settings-field" value={channel} disabled={busy} onChange={event => setChannel(event.target.value as PluginUpdateChannel)}>
            <option value="stable">{t('pluginUpdates.stable')}</option><option value="prerelease">{t('pluginUpdates.prerelease')}</option>
          </select>
        </label>
        <p>{t('pluginUpdates.sourceHint')}</p>
      </>}
      <Button size="sm" disabled={busy || ((kind === 'github' || kind === 'manifest') && !value.trim())} onClick={save}>{t('pluginUpdates.saveSource')}</Button>
    </div>
  </div>;
}
