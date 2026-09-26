import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeColors } from '../types/theme';
import { lastInputWasKeyboard } from '../services/inputModality';

interface Props {
  count: number;
  total: number;
  colors: ThemeColors;
  onToggleAll: () => void;
  onRemove: () => void;
  onDone: () => void;
}
export default function LibrarySelectionBar({ count, total, colors, onToggleAll, onRemove, onDone }: Props) {
  const { t } = useTranslation();
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (lastInputWasKeyboard()) done.current?.focus(); }, []);
  return <div className="library-selection-bar flex items-center flex-wrap gap-3 mb-3 px-4 py-2 text-sm"
    role="toolbar" aria-label={t('library.selectMultiple')}
    style={{ backgroundColor: `${colors.primary}15`, color: colors.textPrimary, borderRadius: 'var(--theme-control-radius)' }}>
    <span aria-live="polite" className="mr-auto">{count} {t('library.selectedCount')}</span>
    <button className="px-2 py-1" onClick={onToggleAll}>{t(count === total && total > 0 ? 'library.clearSelection' : 'library.selectAll')}</button>
    <button className="px-2 py-1 disabled:opacity-40" disabled={count === 0} onClick={onRemove} style={{ color: colors.error }}>{t('library.removeSelected')}</button>
    <button ref={done} className="px-3 py-1 font-semibold" onClick={onDone} style={{ color: colors.primary }}>{t('common.done')}</button>
  </div>;
}
