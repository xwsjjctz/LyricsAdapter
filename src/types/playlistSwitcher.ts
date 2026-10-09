/** One card pushed to the native macOS playlist switcher. */
export interface PlaylistSwitcherCard {
  name: string;
  detail: string;
  /** SF Symbol name used when there is no cover, or while the cover loads. */
  symbol: string;
  /** Cover URL; the main process resolves pixels and pushes them by URL. */
  cover: string | null;
}

export interface PlaylistSwitcherState {
  open: boolean;
  darkMode: boolean;
  label: string;
  hint: string;
  /** Index into `cards`, or -1 while closed. */
  selected: number;
  cards: PlaylistSwitcherCard[];
}

/** Pointer intents only: the page keeps the keyboard and the gesture. */
export interface PlaylistSwitcherAction {
  /** `hover` previews the card under a moving pointer; `activate` commits a click. */
  type: 'hover' | 'activate';
  /** Card index. */
  value: number;
}

/** Sessions with more cards than this stay on the web panel. */
export const PLAYLIST_SWITCHER_MAX_CARDS = 200;
