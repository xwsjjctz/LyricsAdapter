/**
 * Windows 11 window chrome shared by the main process and the renderer.
 *
 * The caption buttons are drawn by the system (Window Controls Overlay), so
 * they keep Snap Layouts and native hover colours. The renderer only reports
 * whether the content behind them is light or dark.
 */

/** Height of the Windows 11 caption area (and of the native caption buttons). */
export const WINDOWS_TITLE_BAR_HEIGHT = 32;

/** First Windows 11 build (22H2) that honours DWMWA_SYSTEMBACKDROP_TYPE. */
const SYSTEM_BACKDROP_MIN_BUILD = 22621;

export type WindowChromeTone = 'light' | 'dark';

/**
 * `theme` is the app theme; Mica and native menus follow it. `captions` is the
 * content behind the caption buttons, which FocusMode keeps dark.
 */
export interface WindowChromeAppearance {
  theme: WindowChromeTone;
  captions: WindowChromeTone;
}

export interface WindowsTitleBarOverlay {
  color: string;
  symbolColor: string;
  height: number;
}

/** Build number from a Windows `os.release()` such as `10.0.22631`, or 0. */
export function getWindowsBuild(osRelease?: string): number {
  const build = Number.parseInt(osRelease?.split('.')[2] ?? '', 10);
  return Number.isFinite(build) ? build : 0;
}

/** Whether Mica can show through the window; older builds paint it black. */
export function supportsWindowsSystemBackdrop(osRelease?: string): boolean {
  return getWindowsBuild(osRelease) >= SYSTEM_BACKDROP_MIN_BUILD;
}

function isWindowChromeTone(value: unknown): value is WindowChromeTone {
  return value === 'light' || value === 'dark';
}

export function isWindowChromeAppearance(value: unknown): value is WindowChromeAppearance {
  if (typeof value !== 'object' || value === null) return false;
  const { theme, captions } = value as Record<string, unknown>;
  return isWindowChromeTone(theme) && isWindowChromeTone(captions);
}

/** Transparent caption buttons whose glyphs follow the content behind them. */
export function getWindowsTitleBarOverlay(tone: WindowChromeTone): WindowsTitleBarOverlay {
  return {
    color: '#00000000',
    // Fluent TextFillColorPrimary for each theme.
    symbolColor: tone === 'dark' ? '#ffffff' : '#1b1b1b',
    height: WINDOWS_TITLE_BAR_HEIGHT,
  };
}
