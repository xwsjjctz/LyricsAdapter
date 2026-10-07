import type { ShortcutAction } from '../constants/shortcuts';

export type ApplicationMenuAction = Extract<ShortcutAction,
  'importMusic' | 'focusSearch' | 'toggleFocusMode' | 'toggleCommandPalette' | 'cyclePlaylists' | 'gotoSettings'
> | 'showShortcuts';
