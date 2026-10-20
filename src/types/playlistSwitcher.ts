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

/** Pointer intents: the page keeps the keyboard and the gesture. */
export interface PlaylistSwitcherPointerAction {
  /** `hover` previews the card under a moving pointer; `activate` commits a click. */
  type: 'hover' | 'activate';
  /** Card index. */
  value: number;
}

/** Where the open panel sits, in page CSS pixels from the top left, so the page can blur only beneath it. */
export interface PlaylistSwitcherFrameAction {
  type: 'frame';
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PlaylistSwitcherAction = PlaylistSwitcherPointerAction | PlaylistSwitcherFrameAction;

/** Sessions with more cards than this stay on the web panel. */
export const PLAYLIST_SWITCHER_MAX_CARDS = 200;
