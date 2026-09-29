import { useTranslation } from 'react-i18next';
import type { OnlineProgressEntry } from '../../types/onlineProgress';

/** A passive overlay: clicking or dragging a cover keeps its usual meaning. */
export default function PosterDownloadProgress({ entry, title, compact }: { entry: OnlineProgressEntry; title: string; compact: boolean }) {
  const { t } = useTranslation();
  const percent = Number.isFinite(entry.percent) ? Math.max(0, Math.min(100, Math.round(entry.percent))) : 0;
  const active = !entry.status;
  const transferring = active && (!entry.phase || entry.phase === 'downloading');
  const label = entry.status === 'completed' ? t('notifications.downloadComplete')
    : entry.status === 'error' ? t('notifications.downloadFailed')
      : t(`wall.download.${entry.phase ?? 'downloading'}`);
  const icon = entry.status === 'completed' ? 'check' : entry.status === 'error' ? 'error_outline'
    : entry.phase === 'saving' ? 'save' : 'download';

  return (
    <div className={`wall-tile__download${compact ? ' wall-tile__download--compact' : ''}`}>
      <div className={`wall-download-badge wall-download-badge--${entry.status ?? 'active'}`}
        role={active ? 'progressbar' : 'status'}
        aria-label={`${title}：${label}`}
        aria-valuemin={active ? 0 : undefined}
        aria-valuemax={active ? 100 : undefined}
        aria-valuenow={transferring ? percent : undefined}>
        <span className="wall-download-badge__ring" aria-hidden="true">
          <svg viewBox="0 0 44 44" fill="none">
            <circle className="wall-download-badge__track" cx="22" cy="22" r="19" />
            <circle className="wall-download-badge__fill" cx="22" cy="22" r="19" pathLength="100"
              strokeDasharray={`${active ? percent : 100} 100`} />
          </svg>
          {transferring ? <span className="wall-download-badge__percent">{percent}%</span>
            : <span className="material-symbols-outlined">{icon}</span>}
        </span>
        <span className="wall-download-badge__label">{label}</span>
      </div>
    </div>
  );
}
