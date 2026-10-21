import { useTranslation } from 'react-i18next';
import type { PluginTranslationStatus } from '../../hooks/usePluginTranslation';
import { PlaybackIcon, usePlaybackSymbols } from '../PlaybackIcon';
import './FocusTranslateButton.css';

/** Which playback control layout hosts the toggle; the macOS glass bar draws its own. */
export type FocusTranslatePlacement = 'inline' | 'bar' | 'glass';

interface FocusTranslateButtonProps {
  status: PluginTranslationStatus;
  onToggle: () => void;
  /** `inline` joins the portrait volume row, `bar` the landscape web controls, `glass` the Windows glass bar. */
  placement?: FocusTranslatePlacement;
  disabled?: boolean;
}

const LABEL_KEYS: Record<Exclude<PluginTranslationStatus, 'unavailable'>, string> = {
  idle: 'plugins.translate',
  translating: 'plugins.translating',
  translated: 'plugins.translated',
  error: 'plugins.translateRetry',
};

const PLACEMENT_CLASS: Record<FocusTranslatePlacement, string> = {
  inline: 'focus-translate-button--inline',
  bar: 'focus-translate-button--bar focus-control-icon focus-control-icon--muted',
  // Placed and coloured by windowsFocusControls.css like the other Windows focus buttons.
  glass: 'focus-glass-translate',
};

/**
 * Starts the lyric translation on request. The icon only switches between the translate glyph
 * and a spinner, so playback and the lyric renderers are untouched until the finished
 * translation replaces the lines. Its state is carried by the accessible name.
 */
export default function FocusTranslateButton({ status, onToggle, placement = 'inline', disabled = false }: FocusTranslateButtonProps) {
  const { t } = useTranslation();
  const symbols = usePlaybackSymbols();
  if (status === 'unavailable') return null;
  const busy = status === 'translating';
  return (
    <button
      type="button"
      className={`focus-translate-button ${PLACEMENT_CLASS[placement]}`}
      data-testid="focus-translate-button"
      data-status={status}
      aria-label={t(LABEL_KEYS[status])}
      aria-pressed={status === 'translated'}
      aria-busy={busy || undefined}
      disabled={busy || disabled}
      onClick={onToggle}
    >
      {busy
        ? <span aria-hidden="true" className="material-symbols-rounded animate-spin motion-reduce:animate-none">progress_activity</span>
        // The portrait row draws its neighbours with SF Symbols on macOS; the other layouts keep Material.
        : <PlaybackIcon symbols={placement === 'inline' ? symbols : {}} name="translate" className="material-symbols-rounded" aria-hidden="true" />}
    </button>
  );
}
