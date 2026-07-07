import type { LibrarySlot, SlotId } from '../../types';

/**
 * Display metadata for a card on the new-UI card wall. This carries only what
 * the wall needs to render (title / subtitle / icon / cover collage). It
 * intentionally does NOT include `tracks` — tracks belong to a slot and are
 * fetched on demand when a panel opens. Previously a single `PlaylistEntry`
 * forced every card (including settings/theme, which have no tracks) to carry
 * an empty `tracks: []`, blurring the line between "card" and "playlist data".
 */
export interface CardMeta {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  coverUrls: string[];
}

/**
 * Discriminated union of card kinds. The `kind` field is the single branching
 * point, so consumers narrow with a switch instead of string-comparing `id`.
 */
export type CardEntry =
  | (CardMeta & { kind: 'slot'; slotId: SlotId })
  | (CardMeta & { kind: 'online-playlist'; source: 'qq' | 'netease'; playlistId: string })
  | (CardMeta & { kind: 'overlay'; overlay: 'settings' | 'theme' });

export type LibrarySlotsById = Record<SlotId, LibrarySlot>;
