import type { ShortcutAction } from '../services/shortcuts';

export type PaletteCommandGroup = 'navigation' | 'library' | 'playback' | 'appearance' | 'settings';

/**
 * One searchable entry in the command palette's "features" mode. Titles are
 * already localized; `keywords` carries aliases (English, synonyms) so a
 * command can be found in any UI language.
 */
export interface PaletteCommand {
  id: string;
  title: string;
  icon: string;
  /** Optional artwork for content entries; an empty URL uses the default cover. */
  coverUrl?: string | undefined;
  group: PaletteCommandGroup;
  keywords?: readonly string[];
  /** Trailing detail such as a track count or the current state. */
  detail?: string | undefined;
  /** Existing shortcut shown next to the title. */
  shortcut?: ShortcutAction;
  /** Keep the palette open after running (toggles people repeat). */
  keepOpen?: boolean;
  /** Opens a nested list instead of running. */
  children?: () => PaletteCommand[];
  run?: () => void | Promise<void>;
}
