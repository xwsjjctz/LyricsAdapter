import { useEffect, useRef, useState, type RefObject } from 'react';
import { readFocusGlassPresentation } from '../components/focus-mode/useFocusGlassControls';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import type {
  LibraryToolbarGlassAction,
  LibraryToolbarGlassButtonState,
  LibraryToolbarGlassSymbol,
  LibraryToolbarGlassState,
} from '../types/libraryToolbarGlass';

interface ButtonOptions {
  ref: RefObject<HTMLButtonElement | null>;
  symbol: LibraryToolbarGlassSymbol;
  enabled: boolean;
  emphasized: boolean;
  tintColor: string;
  label: string;
}

interface Options {
  primary: ButtonOptions;
  secondary: ButtonOptions;
  onPrimary: () => void;
  onSecondary: () => void;
  onPrimaryHoverChange: (hovered: boolean) => void;
}

function presentation(element: HTMLButtonElement | null) {
  const value = readFocusGlassPresentation(element);
  if (!element || value.opacity <= 0 || value.width <= 0 || value.height <= 0) return value;
  const rect = element.getBoundingClientRect();
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return top && element.contains(top) ? value : { ...value, opacity: 0 };
}

/** AppKit owns only the two glass buttons; library behavior remains in React. */
export function useLibraryToolbarGlass(options: Options): boolean {
  const latest = useRef(options);
  latest.current = options;
  const [active, setActive] = useState(false);
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.libraryToolbarGlass : undefined;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const unsubscribe = api.onAction((action: LibraryToolbarGlassAction) => {
      if (cancelled) return;
      if (action.type === 'primary') latest.current.onPrimary();
      else if (action.type === 'secondary') latest.current.onSecondary();
      else latest.current.onPrimaryHoverChange(action.value > 0);
    });
    void api.start().then(result => {
      if (!cancelled) setActive(result.ok && result.data);
    }).catch(error => logger.warn('[LibraryToolbarGlass] Using web buttons:', error));
    return () => {
      cancelled = true;
      unsubscribe();
      void api.stop().catch(error => logger.warn('[LibraryToolbarGlass] Cleanup failed:', error));
    };
  }, [api]);

  const sync = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active || !api) return;
    let cancelled = false;
    let frame = 0;
    let deadline = 0;
    let last = '';
    const fallback = () => {
      if (cancelled) return;
      cancelled = true;
      setActive(false);
      void api.stop().catch(error => logger.warn('[LibraryToolbarGlass] Cleanup failed:', error));
    };
    const buttonState = (button: ButtonOptions): LibraryToolbarGlassButtonState => ({
      presentation: presentation(button.ref.current),
      symbol: button.symbol,
      enabled: button.enabled,
      emphasized: button.emphasized,
      tintColor: button.tintColor,
      label: button.label,
    });
    const send = () => {
      if (cancelled) return;
      const current = latest.current;
      const state: LibraryToolbarGlassState = {
        darkMode: document.documentElement.classList.contains('theme-dark'),
        primary: buttonState(current.primary),
        secondary: buttonState(current.secondary),
      };
      const serialized = JSON.stringify(state);
      if (serialized === last) return;
      last = serialized;
      void api.update(state).then(result => { if (!result.ok) fallback(); }).catch(fallback);
    };
    const tick = () => {
      frame = 0;
      send();
      if (!cancelled && performance.now() < deadline) frame = requestAnimationFrame(tick);
    };
    const follow = () => {
      send();
      deadline = performance.now() + 750;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    sync.current = follow;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    for (const ref of [latest.current.primary.ref, latest.current.secondary.ref]) {
      if (ref.current) resize?.observe(ref.current);
    }
    const theme = new MutationObserver(follow);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('scroll', follow, true);
    document.addEventListener('transitionrun', follow);
    window.addEventListener('resize', follow);
    follow();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      theme.disconnect();
      document.removeEventListener('scroll', follow, true);
      document.removeEventListener('transitionrun', follow);
      window.removeEventListener('resize', follow);
      sync.current = null;
    };
  }, [active, api]);

  const { symbol: primarySymbol, enabled: primaryEnabled, emphasized: primaryEmphasized, tintColor: primaryTint, label: primaryLabel } = options.primary;
  const { symbol: secondarySymbol, enabled: secondaryEnabled, emphasized: secondaryEmphasized, tintColor: secondaryTint, label: secondaryLabel } = options.secondary;
  useEffect(() => { sync.current?.(); }, [
    active,
    primarySymbol, primaryEnabled, primaryEmphasized, primaryTint, primaryLabel,
    secondarySymbol, secondaryEnabled, secondaryEmphasized, secondaryTint, secondaryLabel,
  ]);
  return active;
}
