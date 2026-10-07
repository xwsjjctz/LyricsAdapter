import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveCoverUrl, toCoverThumb } from '../../services/coverUrl';
import { usePlaylistSwitcher } from './usePlaylistSwitcher';
import type { PlaylistSwitchItem } from './types';
import './PlaylistSwitcher.css';

export default function PlaylistSwitcher({ items, activeId }: { items: readonly PlaylistSwitchItem[]; activeId: string }) {
  const { t } = useTranslation();
  const { session, select, cancel, activate } = usePlaylistSwitcher(items, activeId);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = !!session;
  const selected = session?.items.findIndex(item => item.id === session.selectedId) ?? -1;
  useEffect(() => { if (open) listRef.current?.focus(); }, [open]);
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const revealSelection = () => list.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    revealSelection();
    window.addEventListener('resize', revealSelection);
    return () => window.removeEventListener('resize', revealSelection);
  }, [open, selected]);
  if (!session) return null;

  return <div className="playlist-switcher-backdrop" data-controlbar-passthrough onMouseDown={cancel}>
    <section className="playlist-switcher" role="dialog" aria-modal="true" aria-label={t('playlistSwitcher.label')}
      style={{ '--switcher-columns': Math.min(session.items.length, 5) } as CSSProperties}
      data-playlist-switcher data-testid="playlist-switcher" onMouseDown={event => event.stopPropagation()}>
      <div ref={listRef} className="playlist-switcher__items" role="listbox" tabIndex={-1}
        aria-label={t('playlistSwitcher.label')} aria-activedescendant={`${id}-${selected}`}>
        {session.items.map((item, index) => <button key={item.id} id={`${id}-${index}`} type="button" role="option"
          tabIndex={-1} aria-selected={item.id === session.selectedId} aria-label={item.name}
          // Opening under a stationary pointer must not override keyboard selection.
          onMouseMove={event => { if (event.movementX || event.movementY) select(item.id); }}
          onClick={() => activate(item.id)}>
          <span className="playlist-switcher__artwork" aria-hidden="true">
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.coverUrl && <img src={toCoverThumb(resolveCoverUrl(item.coverUrl), 192)} alt="" draggable={false}
              onError={event => { event.currentTarget.hidden = true; }} />}
          </span>
          <span className="playlist-switcher__name">{item.name}</span>
          <span className="playlist-switcher__detail">{item.detail}</span>
        </button>)}
      </div>
      <p className="playlist-switcher__hint">{t(session.modifier ? 'playlistSwitcher.hint' : 'playlistSwitcher.confirmHint', {
        modifier: session.modifier === 'Meta' ? 'Cmd' : 'Ctrl',
      })}</p>
    </section>
  </div>;
}
