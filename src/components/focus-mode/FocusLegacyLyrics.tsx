import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from 'react';
import type { Track } from '../../types';
import FocusLyricRow from './FocusLyricRow';

const PRE_SCROLL_TIME_SECONDS = 0.2;
const MANUAL_SCROLL_RETURN_DELAY_MS = 3_000;

function bezierEaseOut(progress: number): number {
  return 1 - Math.pow(1 - progress, 3) * (1 - progress * 0.3);
}

function bezierEaseOutLong(progress: number): number {
  return progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
}

export interface FocusLegacyLyricsProps {
  track: Track;
  currentTime: number;
  currentTimeRef: MutableRefObject<number>;
  isPlaying: boolean;
  isVisible: boolean;
  fontSize: number;
  lineSpacing: number;
  inactiveBlur: number;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  onSeek: (time: number) => void;
}

/**
 * Focus Mode's pre-AMLL lyric renderer, kept intact as the default renderer.
 * Scrolling offsets stay in the DOM so line transitions do not rerender every row.
 */
export default function FocusLegacyLyrics({
  track,
  currentTime,
  currentTimeRef,
  isPlaying,
  isVisible,
  fontSize,
  lineSpacing,
  inactiveBlur,
  textPrimary,
  textSecondary,
  textMuted,
  onSeek,
}: FocusLegacyLyricsProps) {
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lyricListRef = useRef<HTMLDivElement>(null);
  const autoOffsetRef = useRef(0);
  const currentOffsetRef = useRef(0);
  const lyricAnimationRef = useRef<number | null>(null);
  const preScrolledIndexRef = useRef(-1);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [manualOffsetY, setManualOffsetY] = useState(0);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Match the lyric source preparation used immediately before the AMLL migration.
  const lyricsLines = useMemo(() => {
    if (track.syncedLyrics?.length) {
      if (track.source === 'netease' && (track.title || track.artist)) {
        const titleText = [track.title, track.artist].filter(Boolean).join(' - ');
        if (titleText) return [{ time: 0, text: titleText }, ...track.syncedLyrics];
      }
      return track.syncedLyrics;
    }
    if (track.lyrics) {
      return track.lyrics
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^\[\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?\]/, ''))
        .filter((line) => line.length > 0 && line !== '//')
        .map((text) => ({ time: 0, text }));
    }
    return [];
  }, [track.syncedLyrics, track.lyrics, track.source, track.title, track.artist]);
  const hasLyrics = lyricsLines.length > 0;

  const activeIndex = useMemo(() => {
    if (!hasLyrics) return -1;
    if (track.syncedLyrics?.length) {
      for (let index = lyricsLines.length - 1; index >= 0; index -= 1) {
        if (lyricsLines[index] && currentTime >= lyricsLines[index]!.time) return index;
      }
      return 0;
    }
    if (track.duration > 0) {
      return Math.floor((currentTime / track.duration) * lyricsLines.length);
    }
    return 0;
  }, [currentTime, hasLyrics, lyricsLines, track.duration, track.syncedLyrics]);

  const getScrollBounds = useCallback(() => {
    const container = lyricsRef.current;
    const lyricList = lyricListRef.current;
    if (!container || !lyricList) return { min: -Infinity, max: Infinity };

    const containerHeight = container.clientHeight;
    const lineElements = Array.from(lyricList.children) as HTMLElement[];
    if (lineElements.length === 0) return { min: -Infinity, max: Infinity };

    let totalContentHeight = 0;
    for (let index = 0; index < lineElements.length; index += 1) {
      totalContentHeight += lineElements[index]!.offsetHeight;
      if (index < lineElements.length - 1) totalContentHeight += lineSpacing;
    }

    const firstLineHeight = lineElements[0]!.offsetHeight;
    const minOffset = containerHeight * 0.02 - totalContentHeight + firstLineHeight / 2;
    const lastLineHeight = lineElements[lineElements.length - 1]!.offsetHeight;
    const maxOffset = containerHeight * 0.2 - lastLineHeight / 2;
    return { min: minOffset, max: maxOffset };
  }, [lineSpacing]);

  useEffect(() => {
    const lyricsElement = lyricsRef.current;
    if (!lyricsElement) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setIsUserScrolling(true);
      const bounds = getScrollBounds();
      setManualOffsetY((previous) => {
        const next = previous - event.deltaY;
        const minManual = bounds.min - autoOffsetRef.current;
        const maxManual = bounds.max - autoOffsetRef.current;
        return Math.max(minManual, Math.min(maxManual, next));
      });

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        setIsUserScrolling(false);
        setManualOffsetY(0);
      }, MANUAL_SCROLL_RETURN_DELAY_MS);
    };

    lyricsElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => lyricsElement.removeEventListener('wheel', handleWheel);
  }, [getScrollBounds, hasLyrics, lyricsLines]);

  const handleMouseDown = (event: ReactMouseEvent) => {
    isDraggingRef.current = true;
    dragStartYRef.current = event.clientY;
    dragStartOffsetRef.current = manualOffsetY;
    setIsUserScrolling(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
  };

  const handleMouseMove = (event: ReactMouseEvent) => {
    if (!isDraggingRef.current) return;
    const bounds = getScrollBounds();
    const minManual = bounds.min - autoOffsetRef.current;
    const maxManual = bounds.max - autoOffsetRef.current;
    const next = dragStartOffsetRef.current + event.clientY - dragStartYRef.current;
    setManualOffsetY(Math.max(minManual, Math.min(maxManual, next)));
  };

  const scheduleScrollReturn = () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setIsUserScrolling(false);
      setManualOffsetY(0);
    }, MANUAL_SCROLL_RETURN_DELAY_MS);
  };

  const handleMouseUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    scheduleScrollReturn();
  };

  const handleMouseLeave = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    scheduleScrollReturn();
  };

  const applyLyricOffset = useCallback((nextOffset: number) => {
    currentOffsetRef.current = nextOffset;
    if (lyricListRef.current) {
      lyricListRef.current.style.transform = `translateY(${nextOffset}px)`;
    }
  }, []);

  useEffect(() => {
    preScrolledIndexRef.current = -1;
  }, [fontSize, lineSpacing, track.id]);

  const lyricScrollTargetIndex = useMemo(() => {
    if (activeIndex < 0) return -1;
    const earliestTime = currentTime - 0.1;
    const latestTime = currentTime + PRE_SCROLL_TIME_SECONDS;
    let low = 0;
    let high = lyricsLines.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (lyricsLines[middle]!.time <= earliestTime) low = middle + 1;
      else high = middle;
    }
    if (low < lyricsLines.length && lyricsLines[low]!.time <= latestTime) return low;
    return activeIndex;
  }, [activeIndex, currentTime, lyricsLines]);

  useEffect(() => {
    if (!isVisible || lyricScrollTargetIndex < 0 || !lyricListRef.current || isUserScrolling) return;
    if (lyricScrollTargetIndex === preScrolledIndexRef.current) return;
    preScrolledIndexRef.current = lyricScrollTargetIndex;

    const container = lyricsRef.current;
    const lyricList = lyricListRef.current;
    if (!container || !track.syncedLyrics) return;
    const lineElements = Array.from(lyricList.children) as HTMLElement[];
    if (!lineElements[lyricScrollTargetIndex]) return;

    let offsetToTarget = 0;
    for (let index = 0; index < lyricScrollTargetIndex; index += 1) {
      offsetToTarget += lineElements[index]!.offsetHeight + lineSpacing;
    }
    const targetLineHeight = lineElements[lyricScrollTargetIndex]!.offsetHeight;
    const targetOffset = container.clientHeight * 0.1 - offsetToTarget - targetLineHeight / 2;
    autoOffsetRef.current = targetOffset;

    if (lyricAnimationRef.current !== null) cancelAnimationFrame(lyricAnimationRef.current);
    const startOffset = currentOffsetRef.current;
    const distance = targetOffset - startOffset;
    const startTime = performance.now();
    const isLongDistance = Math.abs(distance) > container.clientHeight * 0.3;
    const duration = isLongDistance ? 900 : Math.min(500 + Math.abs(distance) * 0.4, 750);
    const ease = isLongDistance ? bezierEaseOutLong : bezierEaseOut;

    const animate = (frameTime: number) => {
      const progress = Math.min((frameTime - startTime) / duration, 1);
      applyLyricOffset(startOffset + distance * ease(progress));
      if (progress < 1) {
        lyricAnimationRef.current = requestAnimationFrame(animate);
      } else {
        applyLyricOffset(targetOffset);
        lyricAnimationRef.current = null;
      }
    };
    lyricAnimationRef.current = requestAnimationFrame(animate);
  }, [applyLyricOffset, fontSize, isUserScrolling, isVisible, lineSpacing, lyricScrollTargetIndex, track.syncedLyrics]);

  useEffect(() => {
    if (!isVisible) return;
    if (isUserScrolling) {
      if (lyricAnimationRef.current !== null) {
        cancelAnimationFrame(lyricAnimationRef.current);
        lyricAnimationRef.current = null;
      }
      applyLyricOffset(autoOffsetRef.current + manualOffsetY);
      return;
    }

    const targetOffset = autoOffsetRef.current;
    if (Math.abs(currentOffsetRef.current - targetOffset) <= 0.5) return;
    const startOffset = currentOffsetRef.current;
    const distance = targetOffset - startOffset;
    const startTime = performance.now();
    const animateReturn = (frameTime: number) => {
      const progress = Math.min((frameTime - startTime) / 600, 1);
      applyLyricOffset(startOffset + distance * bezierEaseOut(progress));
      if (progress < 1) {
        lyricAnimationRef.current = requestAnimationFrame(animateReturn);
      } else {
        applyLyricOffset(targetOffset);
        lyricAnimationRef.current = null;
      }
    };
    if (lyricAnimationRef.current !== null) cancelAnimationFrame(lyricAnimationRef.current);
    lyricAnimationRef.current = requestAnimationFrame(animateReturn);
  }, [applyLyricOffset, isUserScrolling, isVisible, manualOffsetY]);

  useEffect(() => {
    if (isVisible || lyricAnimationRef.current === null) return;
    cancelAnimationFrame(lyricAnimationRef.current);
    lyricAnimationRef.current = null;
  }, [isVisible]);

  useEffect(() => {
    preScrolledIndexRef.current = -1;
    applyLyricOffset(0);
    setManualOffsetY(0);
    setIsUserScrolling(false);
    autoOffsetRef.current = 0;
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    if (lyricAnimationRef.current !== null) {
      cancelAnimationFrame(lyricAnimationRef.current);
      lyricAnimationRef.current = null;
    }
  }, [applyLyricOffset, track.id]);

  useEffect(() => () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    if (lyricAnimationRef.current !== null) cancelAnimationFrame(lyricAnimationRef.current);
  }, []);

  const handleLyricClick = useCallback((lyricTime: number, index: number) => {
    if (lyricTime > 0) onSeek(lyricTime);
    if (isUserScrolling && index === activeIndex) {
      setIsUserScrolling(false);
      setManualOffsetY(0);
    }
  }, [activeIndex, isUserScrolling, onSeek]);

  if (!hasLyrics) return null;

  return (
    <div
      className="h-full overflow-hidden relative select-none"
      ref={lyricsRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
      }}
      data-testid="focus-legacy-lyrics"
    >
      <div
        ref={lyricListRef}
        className="flex flex-col py-36 px-8 will-change-transform"
        style={{
          transform: 'translateY(0px)',
          gap: `${lineSpacing}px`,
        }}
      >
        {lyricsLines.map((lyric, index) => {
          const isActive = index === activeIndex;
          const hasTimestamp = Boolean(track.syncedLyrics && lyric.time > 0);
          return (
            <FocusLyricRow
              key={index}
              lyric={lyric}
              index={index}
              isActive={isActive}
              hasTimestamp={hasTimestamp}
              shouldAnimate={isActive && isVisible && isPlaying}
              currentTimeRef={currentTimeRef}
              pausedTime={!isPlaying && isActive ? currentTime : undefined}
              fontSize={fontSize}
              inactiveBlur={inactiveBlur}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              textMuted={textMuted}
              onSeek={handleLyricClick}
            />
          );
        })}
      </div>
    </div>
  );
}
