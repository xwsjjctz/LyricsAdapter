import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ThemeColors } from '../types/theme';
import type { TrackMenuActionId, TrackMenuItem } from './trackMenuItems';
import { lastInputWasKeyboard } from '../services/inputModality';

export interface TrackMenuPosition {
  trackId: string;
  x: number;
  y: number;
  trigger: HTMLElement;
}
interface Props {
  position: TrackMenuPosition;
  colors: ThemeColors;
  items: TrackMenuItem[];
  onClose: () => void;
  onAction: (id: TrackMenuActionId) => void;
}

/** Song context menu shared by every track list; items come from buildTrackMenuItems. */
export default function TrackMenu({ position, colors, items, onClose, onAction }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState({ x: position.x, y: position.y });
  useLayoutEffect(() => {
    const menu = ref.current!;
    const rect = menu.getBoundingClientRect();
    setPoint({ x: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)) });
    // Keyboard users land on the first item; after a right-click the menu itself
    // takes focus so no item looks selected, and arrow keys still work.
    if (lastInputWasKeyboard()) menu.querySelector<HTMLButtonElement>('button')?.focus();
    else menu.focus();
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
  const choose = (id: TrackMenuActionId) => { onClose(); onAction(id); };
  return createPortal(
    <div ref={ref} role="menu" tabIndex={-1} aria-label={t('library.songActions')}
      className="library-track-menu fixed z-[100] p-1.5 shadow-2xl"
      style={{ left: point.x, top: point.y, width: 220, maxWidth: 'calc(100vw - 16px)',
        backgroundColor: colors.backgroundSidebar, color: colors.textPrimary,
        border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-surface-radius)' }}
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
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <div key={`separator-${index}`} className="my-1 border-t" style={{ borderColor: colors.borderLight }} />;
        }
        if (item.kind === 'label') {
          return <div key={`label-${index}`} className="library-menu-label" style={{ color: colors.textMuted }}>{t(item.labelKey)}</div>;
        }
        const label = item.labelKey ? t(item.labelKey) : item.label;
        return (
          <button key={item.id} role="menuitem" className="library-menu-item"
            aria-label={item.groupLabelKey ? `${t(item.groupLabelKey)} ${label}` : undefined}
            style={item.danger ? { color: colors.error } : undefined} onClick={() => choose(item.id)}>
            {label}
          </button>
        );
      })}
    </div>, document.body,
  );
}
