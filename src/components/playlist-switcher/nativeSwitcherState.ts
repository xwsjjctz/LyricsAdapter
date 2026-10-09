import { resolveCoverUrl, toCoverThumb } from '../../services/coverUrl';
import {
  PLAYLIST_SWITCHER_MAX_CARDS,
  type PlaylistSwitcherCard,
  type PlaylistSwitcherState,
} from '../../types/playlistSwitcher';
import { nativeCover, toSfSymbol } from '../palette/nativePaletteState';
import type { PlaylistSwitchItem } from './types';
import type { PlaylistSwitcherSession } from './usePlaylistSwitcher';

// Must stay within the main-process schema, or the whole update is rejected.
const MAX_TEXT = 2048;
const MAX_HINT = 256;
/** Card artwork is drawn at up to 96 pt; request pixels for a 2x display. */
const COVER_SIZE = 192;

function toCard(item: PlaylistSwitchItem): PlaylistSwitcherCard {
  return {
    name: item.name.slice(0, MAX_TEXT),
    detail: item.detail.slice(0, MAX_TEXT),
    symbol: toSfSymbol(item.icon),
    cover: item.coverUrl ? nativeCover(toCoverThumb(resolveCoverUrl(item.coverUrl), COVER_SIZE)) : null,
  };
}

export interface NativeSwitcherInput {
  session: PlaylistSwitcherSession | null;
  darkMode: boolean;
  label: string;
  hint: string;
}

/**
 * Snapshot for the AppKit switcher. A session with more cards than the native
 * surface accepts is reported closed, which keeps that session on the web panel.
 */
export function toNativeSwitcherState({ session, darkMode, label, hint }: NativeSwitcherInput): PlaylistSwitcherState {
  const selected = session ? session.items.findIndex(item => item.id === session.selectedId) : -1;
  if (!session || selected < 0 || session.items.length > PLAYLIST_SWITCHER_MAX_CARDS) {
    return { open: false, darkMode, label, hint: '', selected: -1, cards: [] };
  }
  return { open: true, darkMode, label, hint: hint.slice(0, MAX_HINT), selected, cards: session.items.map(toCard) };
}
