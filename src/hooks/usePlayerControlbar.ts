import { useEffect, useRef, useState, type RefObject } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import { toCoverThumb } from '../services/coverUrl';
import { readFocusGlassPresentation } from '../components/focus-mode/useFocusGlassControls';
import type { PlayerControlbarAction, PlayerControlbarState } from '../types/playerControlbar';

interface Options {
  anchorRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
  artworkUrl?: string | undefined;
  state: Omit<PlayerControlbarState, 'presentation' | 'darkMode'>;
  onFocus: () => void;
  onSeek: (value: number) => void;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  onTogglePlaybackMode: () => void;
}

/**
 * Marks a full-screen scrim (palette, settings sheet, modal) whose bare
 * backdrop may sit over the bar; only its panel content obscures it.
 */
export const CONTROLBAR_PASSTHROUGH_ATTR = 'data-controlbar-passthrough';

/** Hide the AppKit surface whenever another web layer covers its DOM anchor. */
export function controlbarPresentation(element: HTMLElement | null, visible: boolean) {
  const result = readFocusGlassPresentation(element);
  if (!visible || !element) return { ...result, opacity: 0 };
  const rect = element.getBoundingClientRect();
  for (const fraction of [0.05, 0.5, 0.95]) {
    const top = document.elementFromPoint(rect.left + rect.width * fraction, rect.top + rect.height / 2);
    // FocusMode is itself transitioning while the bar slides out. The native
    // controlbar intentionally stays above that page for both directions, so
    // its temporary overlap must not be treated as an obscuring modal.
    const focusTransitionLayer = top instanceof Element && top.closest('.focus-mode-overlay');
    const passthroughScrim = top instanceof Element && top.hasAttribute(CONTROLBAR_PASSTHROUGH_ATTR);
    if (!top || (!element.contains(top) && !focusTransitionLayer && !passthroughScrim)) return { ...result, opacity: 0 };
  }
  return result;
}

/** AppKit owns presentation and controls; callbacks remain player-controller intents. */
export function usePlayerControlbar(options: Options): boolean {
  const latest = useRef(options);
  latest.current = options;
  const [active, setActive] = useState(false);
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.playerControlbar : undefined;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const unsubscribe = api.onAction((action: PlayerControlbarAction) => {
      if (cancelled) return;
      const current = latest.current;
      switch (action.type) {
        case 'focus': current.onFocus(); break;
        case 'toggle-play': current.onTogglePlay(); break;
        case 'previous': current.onSkipPrev(); break;
        case 'next': current.onSkipNext(); break;
        case 'mode': current.onTogglePlaybackMode(); break;
        case 'mute': current.onToggleMute(); break;
        case 'seek': current.onSeek(Math.max(0, Math.min(current.state.duration, action.value))); break;
        case 'volume': current.onVolumeChange(Math.max(0, Math.min(1, action.value))); break;
      }
    });
    void api.start().then(result => {
      if (!cancelled) setActive(result.ok && result.data);
    }).catch(error => logger.warn('[PlayerControlbar] Using web controls:', error));
    return () => {
      cancelled = true;
      unsubscribe();
      void api.stop().catch(error => logger.warn('[PlayerControlbar] Cleanup failed:', error));
    };
  }, [api]);

  const artworkUrl = options.artworkUrl;
  useEffect(() => {
    if (!api || !active) return;
    void api.updateArtwork(toCoverThumb(artworkUrl, 128) ?? null)
      .catch(error => logger.warn('[PlayerControlbar] Artwork update failed:', error));
  }, [active, api, artworkUrl]);

  const sync = useRef<(() => void) | null>(null);
  const animate = useRef<(() => void) | null>(null);
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
      void api.stop().catch(error => logger.warn('[PlayerControlbar] Cleanup failed:', error));
    };
    const send = () => {
      if (cancelled) return;
      const current = latest.current;
      const payload: PlayerControlbarState = {
        ...current.state,
        darkMode: document.documentElement.classList.contains('theme-dark'),
        presentation: controlbarPresentation(current.anchorRef.current, current.visible),
      };
      const serialized = JSON.stringify(payload);
      if (serialized === last) return;
      last = serialized;
      void api.update(payload).then(result => { if (!result.ok) fallback(); }).catch(fallback);
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
    sync.current = send;
    animate.current = follow;
    const anchor = latest.current.anchorRef.current;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow);
    if (anchor) resize?.observe(anchor);
    const mutations = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element))) follow();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    const theme = new MutationObserver(follow);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const transition = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && (target === anchor || target.contains(anchor))) follow();
    };
    document.addEventListener('transitionrun', transition);
    window.addEventListener('resize', follow);
    follow();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      theme.disconnect();
      document.removeEventListener('transitionrun', transition);
      window.removeEventListener('resize', follow);
      sync.current = null;
      animate.current = null;
    };
  }, [active, api]);

  const { enabled, compact, isPlaying, currentTime, duration, volume, playbackMode, title, artist, labels } = options.state;
  useEffect(() => { sync.current?.(); }, [active, options.visible, enabled, compact, isPlaying, currentTime, duration, volume, playbackMode, title, artist, labels]);
  useEffect(() => { animate.current?.(); }, [active, options.visible]);
  return active;
}
