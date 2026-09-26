import type { FocusGlassPresentation } from './focusGlass';

/** One source in the poster wall's switcher menu. */
export interface WallChromeMenuItem {
  /** `slot:local`, `slot:online` or `playlist:<provider>:<id>`. */
  id: string;
  title: string;
  count: number;
  icon: 'local' | 'history' | 'playlist';
  checked: boolean;
  /** Playlist artwork; the main process resolves it into the native menu. */
  imageUrl: string | null;
}

export interface WallChromeMenuSection {
  title: string;
  items: WallChromeMenuItem[];
}

export interface WallChromeState {
  presentation: FocusGlassPresentation;
  darkMode: boolean;
  /** Current source name shown on the switcher button. */
  title: string;
  labels: { back: string; source: string };
  sections: WallChromeMenuSection[];
}

export type WallChromeAction =
  | { type: 'back'; id: string }
  | { type: 'select'; id: string };
