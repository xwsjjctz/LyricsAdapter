import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlotId } from '../types';
import type { OnlineSource, PlaylistInfo } from '../services/onlineMusicProvider';
import { lastInputWasKeyboard } from '../services/inputModality';

/** What the library is showing: a library slot, or one online playlist. */
export type LibrarySource =
  | { kind: 'slot'; slot: Extract<SlotId, 'local' | 'online'> }
  | { kind: 'playlist'; source: OnlineSource; id: string };

interface LibrarySourceMenuProps {
  current: LibrarySource | null;
  /** Heading text for the current source (a playlist shows its own name). */
  title: string;
  counts: { local: number; online: number };
  /** Visible online playlists (see useVisiblePlaylists). */
  playlists: PlaylistInfo[];
  /** Called when the menu opens, so the caller can refresh hidden playlists. */
  onOpen?: (() => void) | undefined;
  onSelectSlot: (slot: 'local' | 'online') => void;
  onOpenPlaylist: (playlist: PlaylistInfo) => void;
}

const isSameSource = (a: LibrarySource | null, b: LibrarySource): boolean => {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'slot' && b.kind === 'slot') return a.slot === b.slot;
  if (a.kind === 'playlist' && b.kind === 'playlist') return a.source === b.source && a.id === b.id;
  return false;
};

/**
 * Source switcher for the poster wall's floating chrome. Local, online history
 * and every visible online playlist sit side by side; the provider behind a
 * playlist is intentionally not shown.
 */
const LibrarySourceMenu: React.FC<LibrarySourceMenuProps> = ({
  current, title, counts, playlists, onOpen, onSelectSlot, onOpenPlaylist,
}) => {
  const { t } = useTranslation();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) onOpen?.();
  }, [onOpen, open]);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus && lastInputWasKeyboard()) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close, open]);

  // Keyboard users land on the checked item (else the first); a click focuses
  // the menu itself so no item looks selected.
  useEffect(() => {
    if (!open) return;
    if (!lastInputWasKeyboard()) {
      menuRef.current?.focus();
      return;
    }
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
  }, [open, playlists.length]);

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(index + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(index - 1); }
    else if (event.key === 'Home') { event.preventDefault(); focusAt(0); }
    else if (event.key === 'End') { event.preventDefault(); focusAt(items.length - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(false);
  };

  const slotItems = useMemo(() => [
    { slot: 'local' as const, icon: 'hard_drive', label: t('sidebar.local'), count: counts.local },
    { slot: 'online' as const, icon: 'history', label: t('sidebar.online'), count: counts.online },
  ], [counts.local, counts.online, t]);

  const choose = (action: () => void) => {
    close(true);
    action();
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        className="library-source-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('library.switchSource', { source: title })}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); }
        }}
      >
        <span className="library-source-trigger__label">{title}</span>
        <span className="material-symbols-outlined library-source-trigger__chevron" aria-hidden="true">expand_more</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={t('library.sourceMenu')}
          className="library-source-menu"
          onKeyDown={handleMenuKeyDown}
        >
          {slotItems.map(item => (
            <button
              key={item.slot}
              type="button"
              role="menuitemradio"
              aria-checked={isSameSource(current, { kind: 'slot', slot: item.slot })}
              className="library-source-menu__item"
              onClick={() => choose(() => onSelectSlot(item.slot))}
            >
              <span className="library-source-menu__art" aria-hidden="true">
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              </span>
              <span className="library-source-menu__name">{item.label}</span>
              <span className="library-source-menu__count">{item.count}</span>
            </button>
          ))}
          {playlists.length > 0 && (
            <>
              <div className="library-source-menu__separator" role="separator" />
              <div className="library-source-menu__label" aria-hidden="true">{t('sidebar.playlists')}</div>
              {playlists.map(playlist => (
                <button
                  key={`${playlist.source}:${playlist.id}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSameSource(current, { kind: 'playlist', source: playlist.source, id: playlist.id })}
                  className="library-source-menu__item"
                  onClick={() => choose(() => onOpenPlaylist(playlist))}
                >
                  <span className="library-source-menu__art" aria-hidden="true">
                    {playlist.coverUrl
                      ? <img src={playlist.coverUrl} alt="" loading="lazy" />
                      : <span className="material-symbols-outlined text-[18px]">queue_music</span>}
                  </span>
                  <span className="library-source-menu__name">{playlist.name}</span>
                  <span className="library-source-menu__count">{playlist.songCount}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default LibrarySourceMenu;
