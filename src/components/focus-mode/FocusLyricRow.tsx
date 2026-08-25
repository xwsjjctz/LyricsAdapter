import React, { memo, useEffect, useMemo, useRef } from 'react';
import type { LyricWord, SyncedLyricLine } from '../../types';

const decodedLyricCache = new Map<string, string>();

function decodeHtmlEntities(text: string): string {
  const cached = decodedLyricCache.get(text);
  if (cached !== undefined) return cached;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  const decoded = textarea.value;
  if (decodedLyricCache.size >= 2048) decodedLyricCache.clear();
  decodedLyricCache.set(text, decoded);
  return decoded;
}

export function wordFillProgress(currentTime: number, word: LyricWord): number {
  if (!Number.isFinite(currentTime) || word.duration <= 0) return 0;
  return Math.max(0, Math.min(1, (currentTime - word.time) / word.duration));
}

export interface FocusLyricRowProps {
  lyric: SyncedLyricLine;
  isActive: boolean;
  hasTimestamp: boolean;
  shouldAnimate: boolean;
  currentTimeRef: React.MutableRefObject<number>;
  pausedTime?: number | undefined;
  fontSize: number;
  inactiveBlur: number;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  index: number;
  onSeek: (time: number, index: number) => void;
}

/**
 * Karaoke progress is painted directly onto the active row. Playback time is a
 * transient ref so a 60fps fill does not re-render FocusMode or the lyric list.
 */
const FocusLyricRow = memo(({
  lyric, isActive, hasTimestamp, shouldAnimate, currentTimeRef, pausedTime, fontSize, inactiveBlur,
  textPrimary, textSecondary, textMuted, index, onSeek,
}: FocusLyricRowProps) => {
  const timedWords = isActive && lyric.words?.length ? lyric.words : undefined;
  const decodedText = useMemo(() => decodeHtmlEntities(lyric.text), [lyric.text]);
  const decodedWords = useMemo(
    () => lyric.words?.map((word) => decodeHtmlEntities(word.text)),
    [lyric.words],
  );
  const wordElementsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const lastPaintedTimeRef = useRef(Number.NaN);

  useEffect(() => {
    if (!timedWords) return;

    let animationId: number | null = null;
    const paint = () => {
      const playbackTime = pausedTime ?? currentTimeRef.current;
      if (playbackTime !== lastPaintedTimeRef.current) {
        lastPaintedTimeRef.current = playbackTime;
        for (let wordIndex = 0; wordIndex < timedWords.length; wordIndex++) {
          const word = timedWords[wordIndex];
          const element = wordElementsRef.current[wordIndex];
          if (!word || !element) continue;
          const progress = wordFillProgress(playbackTime, word);
          element.style.backgroundSize = `${progress * 100}% 100%, 100% 100%`;
        }
      }
      if (shouldAnimate) animationId = requestAnimationFrame(paint);
    };

    paint();
    return () => {
      if (animationId !== null) cancelAnimationFrame(animationId);
    };
  }, [currentTimeRef, pausedTime, shouldAnimate, timedWords]);

  return (
    <p
      className={`font-bold leading-tight cursor-default ${hasTimestamp ? 'cursor-pointer' : ''}`}
      style={{
        color: isActive ? textPrimary : textMuted,
        fontSize: `${fontSize}px`,
        filter: isActive ? 'none' : `blur(${inactiveBlur}px)`,
        opacity: isActive ? 1 : 0.7,
        transform: isActive ? 'scale(1.018)' : 'scale(0.985)',
        transformOrigin: 'left center',
        transition: 'color 260ms ease, filter 360ms ease, opacity 360ms ease, transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        whiteSpace: 'pre-wrap',
      }}
      onClick={() => hasTimestamp && onSeek(lyric.time, index)}
      onMouseEnter={(event) => { if (!isActive) event.currentTarget.style.color = textSecondary; }}
      onMouseLeave={(event) => { if (!isActive) event.currentTarget.style.color = textMuted; }}
      aria-current={isActive ? 'true' : undefined}
    >
      {timedWords ? timedWords.map((word, wordIndex) => {
        const progress = wordFillProgress(pausedTime ?? currentTimeRef.current, word);
        return (
          <span
            key={`${word.time}-${wordIndex}`}
            ref={(element) => { wordElementsRef.current[wordIndex] = element; }}
            style={{
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
              backgroundImage: `linear-gradient(90deg, ${textPrimary}, ${textPrimary}), linear-gradient(90deg, ${textMuted}, ${textMuted})`,
              backgroundSize: `${progress * 100}% 100%, 100% 100%`,
              backgroundPosition: 'left top, left top',
              backgroundRepeat: 'no-repeat',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              willChange: shouldAnimate ? 'background-size' : undefined,
            }}
          >
            {decodedWords?.[wordIndex] ?? word.text}
          </span>
        );
      }) : decodedText}
    </p>
  );
}, (previous, next) => (
  previous.lyric === next.lyric
  && previous.isActive === next.isActive
  && previous.hasTimestamp === next.hasTimestamp
  && previous.shouldAnimate === next.shouldAnimate
  && previous.pausedTime === next.pausedTime
  && previous.fontSize === next.fontSize
  && previous.inactiveBlur === next.inactiveBlur
  && previous.textPrimary === next.textPrimary
  && previous.textSecondary === next.textSecondary
  && previous.textMuted === next.textMuted
  && previous.index === next.index
  && previous.onSeek === next.onSeek
  && previous.currentTimeRef === next.currentTimeRef
));

FocusLyricRow.displayName = 'FocusLyricRow';

export default FocusLyricRow;
