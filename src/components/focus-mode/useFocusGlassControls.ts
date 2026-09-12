import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '../../services/desktopAdapter';
import { logger } from '../../services/logger';
import type { FocusGlassAction, FocusGlassState, FocusGlassPresentation } from '../../types/focusGlass';

interface Options {
  anchorRef: RefObject<HTMLElement | null>;
  focusVisible: boolean;
  visible: boolean;
  enabled: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackMode: FocusGlassState['playbackMode'];
  scale: number;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onTogglePlaybackMode: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/** Read the same transform/opacity Chromium presents, including interrupted transitions. */
export function readFocusGlassPresentation(element: HTMLElement | null): FocusGlassPresentation {
  if (!element) return { x: 0, y: 1, width: 0, height: 0, opacity: 0 };
  const rect = element.getBoundingClientRect();
  let opacity = 1;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    opacity *= Number(style.opacity || 1);
    if (style.visibility === 'hidden' || style.display === 'none') opacity = 0;
  }
  return { x: rect.x / innerWidth, y: rect.y / innerHeight,
    width: rect.width / innerWidth, height: rect.height / innerHeight, opacity };
}

/** The native surface owns presentation; all playback remains in the controller. */
export function useFocusGlassControls(options: Options): boolean {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const callbacks = useRef(options);
  callbacks.current = options;
  const desktop = getDesktopAPI();
  const api = desktop?.platform === 'darwin' ? desktop.ipc?.focusGlass : undefined;

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const unsubscribe = api.onAction((action: FocusGlassAction) => {
      if (cancelled) return;
      const current = callbacks.current;
      switch (action.type) {
        case 'toggle-play': current.onTogglePlay(); break;
        case 'previous': current.onSkipPrev(); break;
        case 'next': current.onSkipNext(); break;
        case 'mode': current.onTogglePlaybackMode(); break;
        case 'mute': current.onToggleMute(); break;
        case 'seek': current.onSeek(Math.max(0, Math.min(current.duration, action.value))); break;
        case 'volume': current.onVolumeChange(Math.max(0, Math.min(1, action.value))); break;
        case 'hover': action.value ? current.onMouseEnter() : current.onMouseLeave(); break;
      }
    });
    void api.start().then(result => {
      if (!cancelled) setActive(result.ok && result.data);
    }).catch(error => logger.warn('[FocusGlass] Using web controls:', error));
    return () => {
      cancelled = true;
      unsubscribe();
      void api.stop().catch(error => logger.warn('[FocusGlass] Cleanup failed:', error));
    };
  }, [api]);

  // Time labels and the native slider only need four updates per second.
  const currentTime = Math.floor(Math.max(0, options.currentTime) * 4) / 4;
  const { visible, enabled, isPlaying, duration, volume, playbackMode, scale } = options;
  const state = useRef<FocusGlassState | null>(null);
  state.current = {
    visible, enabled, isPlaying, currentTime, duration: Math.max(0, duration), volume, playbackMode,
    scale: Math.max(1, Math.min(3, scale)),
    presentation: { x: 0, y: 1, width: 0, height: 0, opacity: 0 },
    labels: {
      playPause: t('shortcut.playPause'), previous: t('shortcut.prevTrack'), next: t('shortcut.nextTrack'),
      seek: t('controls.seek'), volume: t('controls.volume'), mute: t('controls.mute'),
      mode: t(playbackMode === 'shuffle' ? 'controls.shuffleMode' : playbackMode === 'repeat-one' ? 'controls.repeatOneMode' : 'controls.sequence'),
    },
  };
  const sync = useRef<(() => void) | null>(null);
  const animate = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!api || !active) return;
    let cancelled = false;
    let frame = 0;
    let deadline = 0;
    let last = '';
    const fallback = () => {
      if (cancelled) return;
      cancelled = true;
      setActive(false);
      void api.stop().catch(error => logger.warn('[FocusGlass] Cleanup failed:', error));
    };
    const send = () => {
      if (cancelled || !state.current) return;
      const payload = { ...state.current, presentation: readFocusGlassPresentation(callbacks.current.anchorRef.current) };
      const serialized = JSON.stringify(payload);
      if (last === serialized) return;
      last = serialized;
      void api.update(payload).then(result => { if (!result.ok) fallback(); }).catch(fallback);
    };
    const tick = () => {
      frame = 0;
      send();
      if (!cancelled && performance.now() < deadline) frame = requestAnimationFrame(tick);
    };
    const followTransition = () => {
      // Only sample at display frequency during page/control transitions. Playback
      // time still updates at 4 Hz, and identical frames never cross IPC twice.
      deadline = performance.now() + 750;
      if (!frame) frame = requestAnimationFrame(tick);
      send();
    };
    sync.current = send;
    animate.current = followTransition;
    const anchor = callbacks.current.anchorRef.current;
    const overlay = anchor?.closest('.focus-mode-overlay');
    const content = anchor?.closest('.focus-mode-content');
    const onTransition = (event: Event) => {
      if (event.target === anchor || event.target === overlay || event.target === content) followTransition();
    };
    overlay?.addEventListener('transitionrun', onTransition);
    window.addEventListener('resize', followTransition);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(followTransition);
    if (anchor) observer?.observe(anchor);
    followTransition();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      overlay?.removeEventListener('transitionrun', onTransition);
      window.removeEventListener('resize', followTransition);
      sync.current = null;
      animate.current = null;
    };
  }, [api, active]);
  useEffect(() => { sync.current?.(); }, [active, visible, enabled, isPlaying, currentTime, duration, volume, playbackMode, scale, t]);
  useEffect(() => { animate.current?.(); }, [active, visible, options.focusVisible, scale]);
  return active;
}
