import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react';
import type { LyricLineMouseEvent, OptimizeLyricOptions } from '@applemusic-like-lyrics/core';
import '@applemusic-like-lyrics/core/style.css';
import './FocusAmlLyrics.css';
import type { Track } from '../../types';
import { trackToAmlLyricLines } from './amllLyrics';

const SEEK_JUMP_THRESHOLD_MS = 350;
const SCROLL_RETURN_DELAY_MS = 3_000;
const AMLL_OPTIMIZE_OPTIONS: OptimizeLyricOptions = {
  normalizeSpaces: false,
  resetLineTimestamps: false,
};

type AmlStyle = CSSProperties & {
  '--focus-amll-font-size-adjustment': string;
  '--focus-amll-line-spacing-adjustment': string;
};

export interface FocusAmlLyricsProps {
  track: Track;
  currentTime: number;
  isPlaying: boolean;
  isVisible: boolean;
  fontSize: number;
  lineSpacing: number;
  inactiveBlur: number;
  onSeek: (time: number) => void;
}

export default function FocusAmlLyrics({
  track,
  currentTime,
  isPlaying,
  isVisible,
  fontSize,
  lineSpacing,
  inactiveBlur,
  onSeek,
}: FocusAmlLyricsProps) {
  const playerRef = useRef<LyricPlayerRef>(null);
  const scrollReturnTimerRef = useRef<number | null>(null);
  const previousTimeRef = useRef(Math.round(currentTime * 1000));
  const previousTrackRef = useRef(track.id);
  const lyricLines = useMemo(() => trackToAmlLyricLines(track), [track]);
  const currentTimeMs = Math.max(0, Math.round(currentTime * 1000));
  const isSeeking = previousTrackRef.current !== track.id
    || !isPlaying
    || Math.abs(currentTimeMs - previousTimeRef.current) >= SEEK_JUMP_THRESHOLD_MS;
  previousTimeRef.current = currentTimeMs;
  previousTrackRef.current = track.id;

  const style = useMemo<AmlStyle>(() => ({
    '--focus-amll-font-size-adjustment': `${fontSize - 30}px`,
    '--focus-amll-line-spacing-adjustment': `${(lineSpacing - 24) / 2}px`,
  }), [fontSize, lineSpacing]);

  useLayoutEffect(() => {
    void playerRef.current?.lyricPlayer?.calcLayout(true, true);
  }, [fontSize, lineSpacing]);

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
      className="focus-amll-lyrics"
      style={style}
      lyricLines={lyricLines}
      currentTime={currentTimeMs}
      isSeeking={isSeeking}
      playing={isPlaying}
      disabled={!isVisible}
      alignAnchor="center"
      alignPosition={0.35}
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
