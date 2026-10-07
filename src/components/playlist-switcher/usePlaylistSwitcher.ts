import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { shortcutManager } from '../../services/shortcuts';
import { commandPalette } from '../../hooks/useCommandPalette';
import { getDesktopAPI } from '../../services/desktopAdapter';
import type { PlaylistSwitchItem } from './types';

interface Session {
  items: readonly PlaylistSwitchItem[];
  selectedId: string;
  modifier: 'Meta' | 'Control' | null;
}

/** Hold a modifier to preview; only its release commits one browsing intent. */
export function usePlaylistSwitcher(items: readonly PlaylistSwitchItem[], activeId: string) {
  const latest = useRef({ items, activeId });
  latest.current = { items, activeId };
  const recentIds = useRef<string[]>([activeId]);
  const sessionRef = useRef<Session | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const remember = useCallback((id: string) => {
    const available = new Set(latest.current.items.map(item => item.id));
    recentIds.current = [id, ...recentIds.current.filter(previous => previous !== id && available.has(previous))];
  }, []);
  // Navigation outside the switcher also counts as a visit. Previewing a card
  // does not change recency, and each held gesture keeps its initial order.
  useLayoutEffect(() => { remember(activeId); }, [activeId, remember]);

  const publish = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);
  const finish = useCallback((commit: boolean, id?: string, restoreFocus = true) => {
    const current = sessionRef.current;
    if (!current) return;
    publish(null);
    const previous = previousFocus.current;
    previousFocus.current = null;
    if (!commit && restoreFocus && previous?.isConnected) previous.focus();
    // A playlist removed or hidden during the gesture must not be opened.
    const target = commit ? latest.current.items.find(item => item.id === (id ?? current.selectedId)) : undefined;
    if (target) {
      // Record before navigation renders: rapid separate chords must still
      // alternate between this list and the one just left.
      remember(target.id);
      target.run();
    }
  }, [publish, remember]);
  const select = useCallback((id: string) => {
    const current = sessionRef.current;
    if (current?.items.some(item => item.id === id)) publish({ ...current, selectedId: id });
  }, [publish]);

  useEffect(() => {
    const begin = (reverse: boolean, modifier: Session['modifier']) => {
      if (sessionRef.current || !latest.current.items.length) return;
      const available = new Map(latest.current.items.map(item => [item.id, item]));
      const ids = new Set([...recentIds.current, ...available.keys()]);
      const ordered = [...ids].flatMap(id => {
        const item = available.get(id);
        return item ? [item] : [];
      });
      const index = ordered.findIndex(item => item.id === recentIds.current[0]);
      const next = reverse ? (index <= 0 ? ordered.length - 1 : index - 1) : (index + 1) % ordered.length;
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      commandPalette.close();
      // Freeze order for this session; only the user's confirmation browses.
      publish({ items: ordered, selectedId: ordered[next]!.id, modifier });
    };
    const unsubscribe = getDesktopAPI()?.ipc?.applicationMenu?.onAction(action => {
      if (action === 'cyclePlaylists') begin(false, null);
    });
    const move = (delta: number) => {
      const current = sessionRef.current;
      if (!current) return;
      const index = current.items.findIndex(item => item.id === current.selectedId);
      const next = (index + delta + current.items.length) % current.items.length;
      publish({ ...current, selectedId: current.items[next]!.id });
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || (event.target instanceof Element && event.target.closest('[data-shortcut-recorder]'))) return;
      const trigger = shortcutManager.matchesShortcut('cyclePlaylists', event, true);
      if (!sessionRef.current && !trigger) return;
      if (!sessionRef.current && (!latest.current.items.length || event.repeat)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!sessionRef.current) {
        begin(event.shiftKey, event.metaKey ? 'Meta' : event.ctrlKey ? 'Control' : null);
      } else if (trigger) {
        if (!event.repeat) move(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') finish(false);
      else if (event.key === 'Enter') finish(true);
      else if (event.key === 'Tab') move(event.shiftKey ? -1 : 1);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(-1);
    };
    const keyup = (event: KeyboardEvent) => {
      const current = sessionRef.current;
      if (!current) return;
      const released = current.modifier === 'Meta' ? event.key === 'Meta' && !event.metaKey
        : current.modifier === 'Control' ? event.key === 'Control' && !event.ctrlKey : false;
      if (released) { event.preventDefault(); event.stopImmediatePropagation(); finish(true); }
    };
    const blur = () => finish(false, undefined, false);
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      unsubscribe?.();
      sessionRef.current = null;
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [finish, publish]);

  return { session, select, cancel: () => finish(false), activate: (id: string) => finish(true, id) };
}
