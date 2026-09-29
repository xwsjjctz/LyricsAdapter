import { useTranslation } from 'react-i18next';
import type { OnlineProgressEntry } from '../../hooks/useOnlineMusicIntegration';

export interface DownloadStatus {
  label: string;
  /** 0..1 while downloading. */
  progress?: number | undefined;
  tone: 'active' | 'done' | 'error';
}

/**
 * One line for every online download: progress while any is running, then the
 * last outcome for a few seconds. In-app, so it works when macOS has not
 * allowed the app to post notifications.
 */
export function summarizeDownloads(
  entries: readonly OnlineProgressEntry[],
  t: (key: string, values?: Record<string, unknown>) => string,
): DownloadStatus | null {
  const downloads = entries.filter(entry => entry.type === 'download');
  const active = downloads.filter(entry => !entry.status);
  if (active.length > 0) {
    const percent = active.reduce((sum, entry) => sum + entry.percent, 0) / active.length;
    return {
      label: `${t('search.downloading', { count: active.length })} ${Math.round(percent)}%`,
      progress: percent / 100,
      tone: 'active',
    };
  }
  const failed = downloads.find(entry => entry.status === 'error');
  if (failed) {
    const title = t('notifications.downloadFailed');
    return { label: failed.message ? `${title}: ${failed.message}` : title, tone: 'error' };
  }
  const done = downloads.find(entry => entry.status === 'completed');
  if (done) return { label: done.message || t('notifications.downloadComplete'), tone: 'done' };
  return null;
}

interface DownloadStatusPillProps {
  progress: Readonly<Record<string, OnlineProgressEntry>>;
}

export default function DownloadStatusPill({ progress }: DownloadStatusPillProps) {
  const { t } = useTranslation();
  const status = summarizeDownloads(Object.values(progress), (key, values) => t(key, values ?? {}));
  if (!status) return null;
  return (
    <div className={`wall-float wall-status-pill wall-status-pill--download wall-status-pill--${status.tone}`} role="status">
      {status.tone !== 'active' && (
        <span className="material-symbols-outlined wall-status-pill__icon" aria-hidden="true">
          {status.tone === 'error' ? 'error' : 'check_circle'}
        </span>
      )}
      <span className="wall-status-pill__label">{status.label}</span>
      {status.progress !== undefined && (
        <span className="wall-status-pill__track" aria-hidden="true">
          <span className="wall-status-pill__fill" style={{ width: `${Math.round(Math.min(1, Math.max(0, status.progress)) * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
