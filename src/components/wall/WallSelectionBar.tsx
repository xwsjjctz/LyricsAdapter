import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { lastInputWasKeyboard } from '../../services/inputModality';

interface WallSelectionBarProps {
  count: number;
  total: number;
  /** Distance from the window bottom, above the floating control bar. */
  bottom: number;
  onToggleAll: () => void;
  onRemove: () => void;
  onDone: () => void;
}

/** Floating glass toolbar for the wall's multi-select mode. */
export default function WallSelectionBar({ count, total, bottom, onToggleAll, onRemove, onDone }: WallSelectionBarProps) {
  const { t } = useTranslation();
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (lastInputWasKeyboard()) done.current?.focus(); }, []);
  const allSelected = count === total && total > 0;

  return (
    <div className="wall-float wall-selection-bar" role="toolbar" aria-label={t('library.selectMultiple')} style={{ bottom }}>
      <span aria-live="polite" className="wall-selection-bar__count">{count} {t('library.selectedCount')}</span>
      <button type="button" className="wall-float__button" onClick={onToggleAll}>
        {t(allSelected ? 'library.clearSelection' : 'library.selectAll')}
      </button>
      <button type="button" className="wall-float__button wall-float__button--danger" disabled={count === 0} onClick={onRemove}>
        {t('library.removeSelected')}
      </button>
      <button ref={done} type="button" className="wall-float__button wall-float__button--primary" onClick={onDone}>
        {t('common.done')}
      </button>
    </div>
  );
}
