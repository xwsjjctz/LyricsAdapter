/** One result row pushed to the native macOS command palette. */
export interface NativePaletteRow {
  /** Header shown above this row when it starts a new section; empty otherwise. */
  section: string;
  title: string;
  subtitle: string;
  detail: string;
  shortcut: string;
  /** SF Symbol name used when there is no cover, or while the cover loads. */
  symbol: string;
  /** Cover URL; the main process resolves pixels and pushes them by URL. */
  cover: string | null;
  /** Enter/Tab opens a nested list. */
  nested: boolean;
}

export interface NativePaletteState {
  open: boolean;
  darkMode: boolean;
  label: string;
  modes: string[];
  modeIndex: number;
  hint: string;
  placeholder: string;
  /** SF Symbol before the search field. */
  searchSymbol: string;
  query: string;
  trail: string;
  loading: boolean;
  empty: string;
  selected: number;
  rows: NativePaletteRow[];
}

export type NativePaletteActionType =
  | 'query'       // text: field contents after an edit (never mid-composition)
  | 'move'        // value: +1 / -1
  | 'hover'       // value: row index under the pointer
  | 'activate'    // value: row index, or -1 for the selected row
  | 'tab'
  | 'cycle-mode'
  | 'mode'        // value: mode index clicked
  | 'escape'
  | 'backspace'   // Backspace in an empty field
  | 'shortcut';   // text: DOM key; value: modifier bits (see NATIVE_PALETTE_MODIFIERS)

export interface NativePaletteAction {
  type: NativePaletteActionType;
  value: number;
  text: string;
}

export const NATIVE_PALETTE_MODIFIERS = { meta: 1, ctrl: 2, alt: 4, shift: 8 } as const;
