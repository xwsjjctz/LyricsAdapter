import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ThemeColors } from '../types/theme';

export interface TrackMenuPosition {
  trackId: string;
  x: number;
  y: number;
  trigger: HTMLElement;
}
interface Props {
  position: TrackMenuPosition;
  colors: ThemeColors;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSelect: () => void;
  onRemove: () => void;
}

export default function LibraryTrackMenu({ position, colors, canEdit, onClose, onEdit, onSelect, onRemove }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState({ x: position.x, y: position.y });
  useLayoutEffect(() => {
    const menu = ref.current!;
    const rect = menu.getBoundingClientRect();
    setPoint({ x: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)) });
    menu.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) onClose(); };
    const dismiss = (event: Event) => { if (!menu.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', onClose);
    };
  }, [position, onClose]);
  const choose = (action: () => void) => { onClose(); action(); };
  return createPortal(
    <div ref={ref} role="menu" aria-label={t('library.songActions')}
      className="library-track-menu fixed z-[100] p-1.5 shadow-2xl"
      style={{ left: point.x, top: point.y, width: 220, maxWidth: 'calc(100vw - 16px)',
        backgroundColor: colors.backgroundSidebar, color: colors.textPrimary,
        border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-control-radius)' }}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => {
        const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); position.trigger.focus(); }
        else if (e.key === 'Tab') onClose();
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
            : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      {canEdit && <button role="menuitem" className="library-menu-item" onClick={() => choose(onEdit)}>{t('library.editInfo')}</button>}
      <button role="menuitem" className="library-menu-item" onClick={() => choose(onSelect)}>{t('library.selectMultiple')}</button>
      <div className="my-1 border-t" style={{ borderColor: colors.borderLight }} />
      <button role="menuitem" className="library-menu-item" style={{ color: colors.error }} onClick={() => choose(onRemove)}>{t('library.remove')}</button>
    </div>, document.body,
  );
}
