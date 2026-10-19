import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginTranslationStatus } from '../../hooks/usePluginTranslation';
import './FocusTranslateButton.css';

interface FocusTranslateButtonProps {
  status: PluginTranslationStatus;
  onToggle: () => void;
  scale?: number;
  /** `meta` sits under the track title; `inline` joins the portrait volume row. */
  placement?: 'meta' | 'inline';
}

const LABEL_KEYS: Record<Exclude<PluginTranslationStatus, 'unavailable'>, string> = {
  idle: 'plugins.translate',
  translating: 'plugins.translating',
  translated: 'plugins.translated',
  error: 'plugins.translateRetry',
};

/**
 * Starts the lyric translation on request. The icon only switches between the translate glyph
 * and a spinner, so playback and the lyric renderers are untouched until the finished
 * translation replaces the lines. Its state is carried by the accessible name and tooltip.
 */
export default function FocusTranslateButton({ status, onToggle, scale = 1, placement = 'meta' }: FocusTranslateButtonProps) {
  const { t } = useTranslation();
  if (status === 'unavailable') return null;
  const busy = status === 'translating';
  const label = t(LABEL_KEYS[status]);
  const button = (
    <button
      type="button"
      className={`focus-translate-button focus-translate-button--${placement}`}
      data-testid="focus-translate-button"
      data-status={status}
      aria-label={label}
      aria-pressed={status === 'translated'}
      aria-busy={busy || undefined}
      title={status === 'error' ? t('plugins.translationError') : label}
      disabled={busy}
      onClick={onToggle}
    >
      <span aria-hidden="true" className={`material-symbols-rounded${busy ? ' animate-spin motion-reduce:animate-none' : ''}`}>
        {busy ? 'progress_activity' : 'translate'}
      </span>
    </button>
  );
  if (placement === 'inline') return button;
  return (
    <div className="focus-translate" style={scale > 1 ? { '--focus-translate-scale': scale } as CSSProperties : undefined}>
      {button}
    </div>
  );
}
