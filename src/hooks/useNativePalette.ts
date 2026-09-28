import { useEffect, useRef, useState } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import type { NativePaletteAction, NativePaletteState } from '../types/nativePalette';

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
  const latest = useRef(onAction);
  latest.current = onAction;
  const [active, setActive] = useState(false);
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.nativePalette : undefined;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const unsubscribe = api.onAction(action => { if (!cancelled) latest.current(action); });
    void api.start().then(result => {
      if (!cancelled) setActive(result.ok && result.data);
    }).catch(error => logger.warn('[NativePalette] Using web palette:', error));
    return () => {
      cancelled = true;
      unsubscribe();
      void api.stop().catch(error => logger.warn('[NativePalette] Cleanup failed:', error));
    };
  }, [api]);

  useEffect(() => {
    keyboardOwned = active && state.open;
    return () => { keyboardOwned = false; };
  }, [active, state.open]);

  const serialized = JSON.stringify(state);
  const failed = useRef(false);
  useEffect(() => {
    if (!api || !active || failed.current) return;
    const fallback = (error?: unknown) => {
      if (failed.current) return;
      failed.current = true;
      logger.warn('[NativePalette] Falling back to web palette:', error);
      setActive(false);
      void api.stop().catch(() => undefined);
    };
    void api.update(JSON.parse(serialized) as NativePaletteState)
      .then(result => { if (!result.ok) fallback(result.error); })
      .catch(fallback);
  }, [active, api, serialized]);

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
