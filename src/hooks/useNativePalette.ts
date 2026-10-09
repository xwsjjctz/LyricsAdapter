import { useEffect, useState } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import type { NativePaletteAction, NativePaletteState } from '../types/nativePalette';
import { useNativeSurface } from './useNativeSurface';

let keyboardOwned = false;

/**
 * True while the open native palette's text field holds the keyboard. The page
 * then receives `blur` although the window is still key, so window-focus
 * indicators should ignore that blur; closing returns focus and fires `focus`.
 */
export function nativePaletteOwnsKeyboard(): boolean {
  return keyboardOwned;
}

/**
 * Renders the command palette on macOS 26+ Liquid Glass. Palette state stays
 * in React; this pushes a snapshot on change and routes native input back.
 * Returns false (web palette) on other platforms or after any native failure.
 */
export function useNativePalette(state: NativePaletteState, onAction: (action: NativePaletteAction) => void): boolean {
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.nativePalette : undefined;
  const active = useNativeSurface(api, state, onAction, 'NativePalette');

  useEffect(() => {
    keyboardOwned = active && state.open;
    return () => { keyboardOwned = false; };
  }, [active, state.open]);

  return active;
}

/** Tracks the `theme-dark` class the theme manager toggles on <html>. */
export function useDocumentDarkMode(): boolean {
  const read = () => document.documentElement.classList.contains('theme-dark');
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}
