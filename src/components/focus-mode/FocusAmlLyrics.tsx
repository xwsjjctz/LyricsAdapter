import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react';
import {
  DomLyricPlayer,
  type LyricLine,
  type LyricLineMouseEvent,
  type OptimizeLyricOptions,
} from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';
import './FocusAmlLyrics.css';
import type { Track } from '../../types';
import { trackToAmlLyricLines } from './amllLyrics';
import { FocusAmlAnimationBudget } from './focusAmlAnimationBudget';
import { getDesktopAPI } from '../../services/desktopAdapter';
import { settingsManager } from '../../services/settingsManager';
import { useWindowVisible } from '../../hooks/useWindowVisible';

const subscribeToSettings = (listener: () => void) => settingsManager.subscribe(listener);
const getEnhancedFont = () => {
  const platform = getDesktopAPI()?.platform;
  return platform === 'darwin'
    || (platform === 'win32' && settingsManager.getFocusEnhancedFontEnabled());
};

const SEEK_JUMP_THRESHOLD_MS = 350;
const SCROLL_RETURN_DELAY_MS = 3_000;
const AMLL_OPTIMIZE_OPTIONS: OptimizeLyricOptions = {
  normalizeSpaces: false,
  resetLineTimestamps: false,
};
// AMLL 0.5.2 lays out a group it has not measured at a fifth of the player height.
const UNMEASURED_LINE_HEIGHT_RATIO = 1 / 5;
const REMEASURE_ATTRIBUTE = 'data-focus-amll-remeasure';

type LyricGroup = DomLyricPlayer['currentLyricGroups'][number];

export class FocusDomLyricPlayer extends DomLyricPlayer {
  private readonly animationBudget = new FocusAmlAnimationBudget();
  // Groups carrying REMEASURE_ATTRIBUTE that were in the document after the last update.
  private readonly renderedStaleGroups: LyricGroup[] = [];

  override update(delta?: number): void {
    // A frame has rendered these since, so the browser remembers their translated height.
    for (const group of this.renderedStaleGroups ?? []) {
      if (group.element.isConnected) group.element.removeAttribute(REMEASURE_ATTRIBUTE);
    }
    super.update(delta);
    this.animationBudget?.update(this.currentLyricGroups, this.getCurrentTime());
    if (!this.renderedStaleGroups) return;
    this.renderedStaleGroups.length = 0;
    for (const group of this.currentLyricGroups) {
      if (group.element.isConnected && group.element.hasAttribute(REMEASURE_ATTRIBUTE)) {
        this.renderedStaleGroups.push(group);
      }
    }
  }

  /**
   * Write translation text into the lines already on screen. AMLL's setLyricLines rebuilds
   * every line and springs them in from the top; here AMLL's own ResizeObserver measures the
   * taller lines and springs the following ones down. `lines` must come from the same track:
   * AMLL's optimizer keeps one processed line per input line.
   *
   * Off-screen lines keep their old height: AMLL neither observes them nor drops its cached
   * size, and content-visibility reports the browser's remembered size. Changed groups get
   * REMEASURE_ATTRIBUTE, which renders their content until a frame has shown them.
   */
  updateTranslations(lines: readonly LyricLine[]): void {
    if (lines.length !== this.processedLines.length) return;
    lines.forEach((line, index) => {
      // AMLL keeps its own clones; mutate them so a later rebuild of a line keeps the text.
      for (const owned of [this.currentLyricLines[index], this.processedLines[index]]) {
        if (owned) owned.translatedLyric = line.translatedLyric;
      }
    });
    for (const group of this.currentLyricGroups) {
      let changed = false;
      for (const lineEl of [group.mainLine, group.bgLine]) {
        // AMLL 0.5.2 renders [main, translation, romanisation] as the line's children.
        const subLine = lineEl?.getElement().children[1];
        const text = lineEl?.getLine().translatedLyric ?? '';
        if (subLine && subLine.textContent !== text) {
          subLine.textContent = text;
          changed = true;
        }
      }
      if (changed) group.element.setAttribute(REMEASURE_ATTRIBUTE, '');
    }
  }

  /**
   * Measure the stale groups that returning to the current line will bring into view. Call
   * before that layout: a group resizing on entry makes AMLL relayout synchronously, which
   * drops the per-line delays and moves every line at once.
   */
  measureStaleGroupsOnReturn(): void {
    if (this.currentLyricGroups.length === 0) return;
    const [first, last] = this.returnRange();
    const stale = this.currentLyricGroups.slice(first, last + 1)
      .filter(group => group.element.hasAttribute(REMEASURE_ATTRIBUTE) && !group.element.isConnected);
    for (const group of stale) group.show();
    // Read only after every insertion so the batch costs one layout.
    const measured = stale.map(group => ({
      group,
      size: [group.element.clientWidth, group.element.clientHeight] as [number, number],
    }));
    for (const { group, size } of measured) {
      this.lyricGroupSize.set(group, size);
      group.onLineSizeChange(size);
      // The next frame would hide it anyway. On entry AMLL observes the size cached here.
      if (!group.isInSight) group.hide();
    }
  }

  /** Indices from the scrolled view to the lines shown around the current one. */
  private returnRange(): [number, number] {
    const groups = this.currentLyricGroups;
    const target = Math.min(Math.max(this.timelineState.scrollToIndex, 0), groups.length - 1);
    // Cached heights are what is stale, so walk one overscan further each way.
    const reach = this.getOverscanPx() * 2;
    const above = this.size[1] * this.layoutState.alignPosition + reach;
    const below = this.size[1] * (1 - this.layoutState.alignPosition) + reach;
    const heightOf = (group: LyricGroup | undefined) => (group && this.lyricGroupSize.get(group)?.[1])
      ?? this.size[1] * UNMEASURED_LINE_HEIGHT_RATIO;

    let first = target;
    for (let height = 0; first > 0 && height < above;) height += heightOf(groups[--first]);
    let last = target;
    for (let height = 0; last < groups.length - 1 && height < below;) height += heightOf(groups[++last]);
    // The lines between the scrolled view and the target pass through the view on the way.
    groups.forEach((group, index) => {
      if (!group.element.isConnected) return;
      first = Math.min(first, index);
      last = Math.max(last, index);
    });
    return [first, last];
  }

  override dispose(): void {
    this.resetScroll();
    // AMLL 0.5.2 leaves this observer connected, retaining disposed players.
    this.resizeObserver.disconnect();
    super.dispose();
  }
}

type AmlStyle = CSSProperties & {
  '--amll-lp-font-size': string;
  '--focus-amll-line-spacing-adjustment': string;
};

export interface FocusAmlLyricsProps {
  track: Track;
  translations?: Readonly<Record<string, string>>;
  currentTime: number;
  isPlaying: boolean;
  isVisible: boolean;
  portrait?: boolean;
  fontSize: number;
  lineSpacing: number;
  inactiveBlur: number;
  onSeek: (time: number) => void;
}

export default function FocusAmlLyrics({
  track,
  translations,
  currentTime,
  isPlaying,
  isVisible,
  portrait = false,
  fontSize,
  lineSpacing,
  inactiveBlur,
  onSeek,
}: FocusAmlLyricsProps) {
  const enhancedFont = useSyncExternalStore(subscribeToSettings, getEnhancedFont);
  // AMLL's frame loop keeps running while paused; only `disabled` stops it.
  const windowVisible = useWindowVisible();
  const playerRef = useRef<LyricPlayerRef>(null);
  const scrollReturnTimerRef = useRef<number | null>(null);
  const previousTimeRef = useRef(Math.round(currentTime * 1000));
  const previousTrackRef = useRef(track.id);
  const translatedLines = useMemo(() => trackToAmlLyricLines(track, translations), [track, translations]);
  // Only a new track hands AMLL a new array: setLyricLines restarts the layout from the top.
  // Translation changes are patched into the existing lines by the effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lyricLines = useMemo(() => translatedLines, [track]);
  const currentTimeMs = Math.max(0, Math.round(currentTime * 1000));
  const isSeeking = previousTrackRef.current !== track.id
    || !isPlaying
    || Math.abs(currentTimeMs - previousTimeRef.current) >= SEEK_JUMP_THRESHOLD_MS;
  previousTimeRef.current = currentTimeMs;
  previousTrackRef.current = track.id;

  const style = useMemo<AmlStyle>(() => ({
    '--amll-lp-font-size': `${fontSize}px`,
    '--focus-amll-line-spacing-adjustment': `${(lineSpacing - 24) / 2}px`,
  }), [fontSize, lineSpacing]);

  useLayoutEffect(() => {
    void playerRef.current?.lyricPlayer?.calcLayout(true, true);
  }, [fontSize, lineSpacing, enhancedFont]);

  useLayoutEffect(() => {
    const player = playerRef.current?.lyricPlayer;
    if (player instanceof FocusDomLyricPlayer) player.updateTranslations(translatedLines);
  }, [translatedLines]);

  // AMLL's alignment setters do not recalculate layout. Run after the child
  // applies its new anchor so a paused line also moves when orientation changes.
  useEffect(() => {
    void playerRef.current?.lyricPlayer?.calcLayout(true, true);
  }, [portrait]);

  useEffect(() => {
    const wrapper = playerRef.current?.wrapperEl;
    if (!wrapper || !isVisible) return;

    const clearReturnTimer = () => {
      if (scrollReturnTimerRef.current !== null) {
        window.clearTimeout(scrollReturnTimerRef.current);
        scrollReturnTimerRef.current = null;
      }
    };

    const returnToCurrentLine = () => {
      scrollReturnTimerRef.current = null;
      const player = playerRef.current?.lyricPlayer;
      if (!player) return;
      player.resetScroll();
      if (player instanceof FocusDomLyricPlayer) player.measureStaleGroupsOnReturn();
      void player.calcLayout(false, false);
    };

    const scheduleReturn = () => {
      clearReturnTimer();
      scrollReturnTimerRef.current = window.setTimeout(returnToCurrentLine, SCROLL_RETURN_DELAY_MS);
    };

    wrapper.addEventListener('wheel', scheduleReturn, { capture: true, passive: true });
    wrapper.addEventListener('touchstart', clearReturnTimer, { capture: true, passive: true });
    wrapper.addEventListener('touchend', scheduleReturn, { capture: true, passive: true });
    wrapper.addEventListener('touchcancel', scheduleReturn, { capture: true, passive: true });

    return () => {
      wrapper.removeEventListener('wheel', scheduleReturn, true);
      wrapper.removeEventListener('touchstart', clearReturnTimer, true);
      wrapper.removeEventListener('touchend', scheduleReturn, true);
      wrapper.removeEventListener('touchcancel', scheduleReturn, true);
      clearReturnTimer();
    };
  }, [isVisible, track.id]);

  const handleLineClick = useCallback((event: LyricLineMouseEvent) => {
    onSeek(event.line.getLine().startTime / 1000);
  }, [onSeek]);

  return (
    <LyricPlayer
      ref={playerRef}
      lyricPlayer={FocusDomLyricPlayer}
      className={`focus-amll-lyrics${enhancedFont ? ' focus-amll-lyrics--enhanced-font' : ''}`}
      style={style}
      lyricLines={lyricLines}
      currentTime={currentTimeMs}
      isSeeking={isSeeking}
      playing={isPlaying}
      disabled={!isVisible || !windowVisible}
      alignAnchor={portrait ? 'top' : 'center'}
      alignPosition={portrait ? 0.1 : 0.35}
      enableSpring
      enableScale
      enableBlur={inactiveBlur > 0}
      hidePassedLines={false}
      wordFadeWidth={0.5}
      optimizeOptions={AMLL_OPTIMIZE_OPTIONS}
      onLyricLineClick={handleLineClick}
      aria-label="Scrolling lyrics"
    />
  );
}
