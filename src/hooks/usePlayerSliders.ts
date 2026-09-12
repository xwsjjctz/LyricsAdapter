import { useEffect, useRef, useState, type RefObject } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import { logger } from '../services/logger';
import { readFocusGlassPresentation } from '../components/focus-mode/useFocusGlassControls';
import type { PlayerSlidersState } from '../types/playerSliders';

interface Options {
  seekRef: RefObject<HTMLDivElement>;
  volumeRef: RefObject<HTMLDivElement>;
  visible: boolean;
  state: Omit<PlayerSlidersState, 'seek' | 'volume'>;
  onSeek: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onVolumePresence?: (inside: boolean) => void;
  volumeExpanded?: boolean;
}

/** Native views sit above Chromium, so suppress them wherever web UI covers them. */
export function sliderPresentation(element: HTMLElement | null, visible: boolean) {
  const result = readFocusGlassPresentation(element);
  if (!visible || !element) return { ...result, opacity: 0 };
  const rect = element.getBoundingClientRect();
  // Include both ends: a floating panel can cover only part of a long seek bar.
  for (const fraction of [0.02, 0.5, 0.98]) {
    const top = document.elementFromPoint(rect.left + rect.width * fraction, rect.top + rect.height / 2);
    if (!top || !element.contains(top)) return { ...result, opacity: 0 };
  }
  return result;
}

export function usePlayerSliders(options: Options): boolean {
  const latest = useRef(options); latest.current = options;
  const [active, setActive] = useState(false);
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.playerSliders : undefined;
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const unsubscribe = api.onAction(action => {
      if (cancelled || !latest.current.visible) return;
      if (action.type === 'seek') latest.current.onSeek(Math.max(0, Math.min(latest.current.state.duration, action.value)));
      else if (action.type === 'volume') latest.current.onVolumeChange(Math.max(0, Math.min(1, action.value)));
      else if (action.type === 'volume-presence') latest.current.onVolumePresence?.(action.value !== 0);
    });
    void api.start().then(result => { if (!cancelled) setActive(result.ok && result.data); })
      .catch(error => logger.warn('[PlayerSliders] Using web sliders:', error));
    return () => { cancelled = true; unsubscribe(); void api.stop().catch(error => logger.warn('[PlayerSliders] Cleanup failed:', error)); };
  }, [api]);

  const sync = useRef<(() => void) | null>(null);
  const animate = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!active || !api) return;
    let cancelled = false, frame = 0, deadline = 0, last = '';
    const fallback = () => {
      if (cancelled) return;
      cancelled = true; setActive(false);
      void api.stop().catch(error => logger.warn('[PlayerSliders] Cleanup failed:', error));
    };
    const send = () => {
      if (cancelled) return;
      const current = latest.current;
      const state = { ...current.state,
        seek: sliderPresentation(current.seekRef.current, current.visible),
        volume: sliderPresentation(current.volumeRef.current, current.visible),
      };
      const serialized = JSON.stringify(state);
      if (last === serialized) return;
      last = serialized;
      void api.update(state).then(result => { if (!result.ok) fallback(); }).catch(fallback);
    };
    const tick = () => { frame = 0; send(); if (!cancelled && performance.now() < deadline) frame = requestAnimationFrame(tick); };
    const follow = () => {
      send();
      if (!latest.current.visible) { deadline = 0; return; }
      deadline = performance.now() + 750;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    sync.current = send;
    animate.current = follow;
    const resize = new ResizeObserver(follow);
    for (const element of [latest.current.seekRef.current, latest.current.volumeRef.current]) if (element) resize.observe(element);
    // Modal insertion/removal and sidebar layout can change native occlusion even
    // while playback is paused. Ignore text mutations from the playback clock.
    const mutations = new MutationObserver(records => {
      if (latest.current.visible && records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element))) follow();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    const transition = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && (target.contains(latest.current.seekRef.current) || target.contains(latest.current.volumeRef.current))) follow();
    };
    document.addEventListener('transitionrun', transition);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    follow();
    return () => {
      cancelled = true; cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect();
      document.removeEventListener('transitionrun', transition);
      window.removeEventListener('resize', follow); window.removeEventListener('scroll', follow, true);
      sync.current = null;
      animate.current = null;
    };
  }, [active, api]);
  const { currentTime, duration, level, enabled, labels } = options.state;
  useEffect(() => { sync.current?.(); }, [active, options.visible, currentTime, duration, level, enabled, labels.seek, labels.volume]);
  useEffect(() => { animate.current?.(); }, [active, options.visible, options.volumeExpanded]);
  return active && options.visible;
}
