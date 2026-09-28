import type { PaletteMode } from '../../hooks/useCommandPalette';
import {
  NATIVE_PALETTE_MODIFIERS,
  type NativePaletteRow,
  type NativePaletteState,
} from '../../types/nativePalette';
import type { PaletteItem } from './usePaletteItems';

/** Material Symbols used by palette rows, mapped to their SF Symbol twins. */
const SF_SYMBOLS: Readonly<Record<string, string>> = {
  auto_awesome_mosaic: 'square.grid.2x2',
  category: 'square.stack',
  check: 'checkmark',
  checklist: 'checklist',
  cloud: 'cloud',
  cloud_download: 'icloud.and.arrow.down',
  dark_mode: 'moon',
  fullscreen: 'arrow.up.left.and.arrow.down.right',
  hard_drive: 'internaldrive',
  history: 'clock.arrow.circlepath',
  info: 'info.circle',
  keyboard: 'keyboard',
  language: 'globe',
  library_add: 'plus.rectangle.on.rectangle',
  light_mode: 'sun.max',
  manage_search: 'text.magnifyingglass',
  music_note: 'music.note',
  palette: 'paintpalette',
  play_arrow: 'play.fill',
  queue_music: 'music.note.list',
  refresh: 'arrow.clockwise',
  repeat: 'repeat',
  settings: 'gearshape',
  shuffle: 'shuffle',
  sync: 'arrow.triangle.2.circlepath',
  translate: 'character.bubble',
  tune: 'slider.horizontal.3',
  visibility: 'eye',
  visibility_off: 'eye.slash',
  volume_off: 'speaker.slash',
};
const FALLBACK_SYMBOL = 'circle.dashed';
const SEARCH_SYMBOLS: Readonly<Record<PaletteMode, string>> = { library: 'magnifyingglass', commands: 'bolt' };

// Must stay within the main-process schema, or the whole update is rejected.
const MAX_ROWS = 200;
const MAX_TEXT = 2048;
const MAX_SHORTCUT = 64;
const MAX_COVER_URL = 8192;
// app: serves bundled assets such as the default cover.
const COVER_PROTOCOLS = new Set(['cover:', 'https:', 'http:', 'app:']);

export function toSfSymbol(icon: string | undefined): string {
  return (icon && SF_SYMBOLS[icon]) || FALLBACK_SYMBOL;
}

const clip = (text: string | undefined, max = MAX_TEXT) => (text ?? '').slice(0, max);

/** Only URLs the main process can fetch; anything else keeps the symbol. */
function nativeCover(url: string | undefined): string | null {
  if (!url || url.length > MAX_COVER_URL) return null;
  try {
    return COVER_PROTOCOLS.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

export function toNativeRows(items: readonly PaletteItem[]): NativePaletteRow[] {
  let previousSection: string | null = null;
  return items.slice(0, MAX_ROWS).map(item => {
    const section = item.section !== previousSection ? clip(item.section) : '';
    previousSection = item.section;
    return {
      section,
      title: clip(item.title),
      subtitle: clip(item.subtitle),
      detail: clip(item.detail),
      shortcut: clip(item.shortcut, MAX_SHORTCUT),
      symbol: toSfSymbol(item.icon),
      cover: nativeCover(item.coverUrl),
      nested: !!item.command,
    };
  });
}

export interface NativePaletteInput {
  open: boolean;
  darkMode: boolean;
  mode: PaletteMode;
  modes: readonly PaletteMode[];
  query: string;
  trail: readonly string[];
  loading: boolean;
  selected: number;
  items: readonly PaletteItem[];
  t: (key: string) => string;
}

export function toNativePaletteState(input: NativePaletteInput): NativePaletteState {
  const rows = input.open ? toNativeRows(input.items) : [];
  return {
    open: input.open,
    darkMode: input.darkMode,
    label: input.t('palette.label'),
    modes: input.modes.map(mode => input.t(`palette.mode.${mode}`)),
    modeIndex: Math.max(0, input.modes.indexOf(input.mode)),
    hint: input.t('palette.switchHint'),
    placeholder: input.t(`palette.placeholder.${input.mode}`),
    searchSymbol: SEARCH_SYMBOLS[input.mode],
    query: clip(input.query),
    trail: clip(input.trail.length > 0 ? `${input.trail.join(' › ')} ›` : ''),
    loading: input.loading,
    empty: input.t('search.noResults'),
    selected: rows.length > 0 ? Math.min(Math.max(input.selected, 0), rows.length - 1) : -1,
    rows,
  };
}

/** DOM `code` for a forwarded key, as the shortcut matcher also checks codes. */
function domCode(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key === ' ') return 'Space';
  return key;
}

/**
 * The native search field owns the keyboard while open, so Cmd chords the
 * menu bar did not handle are replayed where global shortcuts listen.
 */
export function dispatchForwardedShortcut(key: string, modifiers: number, target: EventTarget = window): void {
  if (!key) return;
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    code: domCode(key),
    metaKey: (modifiers & NATIVE_PALETTE_MODIFIERS.meta) !== 0,
    ctrlKey: (modifiers & NATIVE_PALETTE_MODIFIERS.ctrl) !== 0,
    altKey: (modifiers & NATIVE_PALETTE_MODIFIERS.alt) !== 0,
    shiftKey: (modifiers & NATIVE_PALETTE_MODIFIERS.shift) !== 0,
    bubbles: true,
    cancelable: true,
  }));
}
