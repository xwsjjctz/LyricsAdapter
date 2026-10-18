import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginTranslationStatus } from '../../hooks/usePluginTranslation';
import './FocusTranslateButton.css';

interface FocusTranslateButtonProps {
  status: PluginTranslationStatus;
  onToggle: () => void;
  scale?: number;
}

const LABEL_KEYS: Record<Exclude<PluginTranslationStatus, 'unavailable'>, string> = {
  idle: 'plugins.translate',
  translating: 'plugins.translating',
  translated: 'plugins.translated',
  error: 'plugins.translateRetry',
};

/**
 * Starts the lyric translation on request. Progress stays inside this pill, so playback and
 * the lyric renderers are untouched until the finished translation replaces the lines.
 */
export default function FocusTranslateButton({ status, onToggle, scale = 1 }: FocusTranslateButtonProps) {
  const { t } = useTranslation();
  if (status === 'unavailable') return null;
  const busy = status === 'translating';
  return (
    <div className="focus-translate" style={scale > 1 ? { '--focus-translate-scale': scale } as CSSProperties : undefined}>
      <button
        type="button"
        className="focus-translate-button"
        data-testid="focus-translate-button"
        data-status={status}
        aria-pressed={status === 'translated'}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={onToggle}
      >
        <span aria-hidden="true" className={`material-symbols-rounded${busy ? ' animate-spin motion-reduce:animate-none' : ''}`}>
          {busy ? 'progress_activity' : 'translate'}
        </span>
        <span>{t(LABEL_KEYS[status])}</span>
      </button>
      {status === 'error' && <p role="status" className="focus-translate-status">{t('plugins.translationError')}</p>}
    </div>
  );
}
