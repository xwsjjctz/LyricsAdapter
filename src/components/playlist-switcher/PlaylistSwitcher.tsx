import { useCallback, useEffect, useId, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNativeSurface } from '../../hooks/useNativeSurface';
import { resolveCoverUrl, toCoverThumb } from '../../services/coverUrl';
import { getDesktopAPI } from '../../services/desktopAdapter';
import type { PlaylistSwitcherAction } from '../../types/playlistSwitcher';
import { toNativeSwitcherState } from './nativeSwitcherState';
import { usePlaylistSwitcher } from './usePlaylistSwitcher';
import type { PlaylistSwitchItem } from './types';
import './PlaylistSwitcher.css';

export default function PlaylistSwitcher({ items, activeId }: { items: readonly PlaylistSwitchItem[]; activeId: string }) {
  const { t } = useTranslation();
  const { session, select, cancel, activate } = usePlaylistSwitcher(items, activeId);
  const focusRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = !!session;
  const selected = session?.items.findIndex(item => item.id === session.selectedId) ?? -1;
  const label = t('playlistSwitcher.label');
  const hint = session ? t(session.modifier ? 'playlistSwitcher.hint' : 'playlistSwitcher.confirmHint', {
    modifier: session.modifier === 'Meta' ? 'Cmd' : 'Ctrl',
  }) : '';

  // macOS 26+ draws the panel on native Liquid Glass. The session, selection
  // and keyboard gesture stay here; AppKit only reports pointer intents.
  const latest = useRef({ session, select, activate });
  latest.current = { session, select, activate };
  const handleNativeAction = useCallback((action: PlaylistSwitcherAction) => {
    const current = latest.current;
    const item = current.session?.items[action.value];
    if (!item) return;
    if (action.type === 'hover') current.select(item.id);
    else current.activate(item.id);
  }, []);
  const desktop = getDesktopAPI();
  // Fixed night colours, like the playback bar: its black tint needs light text.
  const nativeState = toNativeSwitcherState({ session, darkMode: true, label, hint });
  const nativeActive = useNativeSurface(
    desktop?.platform === 'darwin' ? desktop.ipc?.playlistSwitcher : undefined,
    nativeState, handleNativeAction, 'PlaylistSwitcher',
  );
  const native = nativeActive && nativeState.open;

  // Either surface takes focus from the page for the length of the gesture.
  useEffect(() => { if (open) focusRef.current?.focus(); }, [open, native]);
  useEffect(() => {
    const list = focusRef.current;
    if (!open || native || !list) return;
    const revealSelection = () => list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    revealSelection();
    window.addEventListener('resize', revealSelection);
    return () => window.removeEventListener('resize', revealSelection);
  }, [open, native, selected]);
  if (!session) return null;

  // The native glass panel draws above the page; the web layer only dims it
  // and cancels on an outside click.
  if (native) {
    return <div ref={focusRef} className="playlist-switcher-backdrop" tabIndex={-1}
      data-controlbar-passthrough data-native-switcher="true" onMouseDown={cancel} />;
  }

  return <div className="playlist-switcher-backdrop" data-controlbar-passthrough onMouseDown={cancel}>
    <section className="playlist-switcher" role="dialog" aria-modal="true" aria-label={label}
      style={{ '--switcher-columns': Math.min(session.items.length, 5) } as CSSProperties}
      data-playlist-switcher data-testid="playlist-switcher" onMouseDown={event => event.stopPropagation()}>
      <div ref={focusRef} className="playlist-switcher__items" role="listbox" tabIndex={-1}
        aria-label={label} aria-activedescendant={`${id}-${selected}`}>
        {session.items.map((item, index) => <button key={item.id} id={`${id}-${index}`} type="button" role="option"
          tabIndex={-1} aria-selected={item.id === session.selectedId} aria-label={item.name}
          // Opening under a stationary pointer must not override keyboard selection.
          onMouseMove={event => { if (event.movementX || event.movementY) select(item.id); }}
          onClick={() => activate(item.id)}>
          <span className="playlist-switcher__artwork" aria-hidden="true">
            <span className="material-symbols-rounded">{item.icon}</span>
            {item.coverUrl && <img src={toCoverThumb(resolveCoverUrl(item.coverUrl), 192)} alt="" draggable={false}
              onError={event => { event.currentTarget.hidden = true; }} />}
          </span>
          <span className="playlist-switcher__name">{item.name}</span>
          <span className="playlist-switcher__detail">{item.detail}</span>
        </button>)}
      </div>
      <p className="playlist-switcher__hint">{hint}</p>
    </section>
  </div>;
}
