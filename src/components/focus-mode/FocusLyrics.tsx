import { lazy, Suspense, type MutableRefObject } from 'react';
import type { Track } from '../../types';
import FocusLegacyLyrics from './FocusLegacyLyrics';
import { hasTrackLyrics } from './focusLyricsTrack';

const FocusAmlLyrics = lazy(() => import('./FocusAmlLyrics'));

export interface FocusLyricsProps {
  track: Track | null;
  currentTime: number;
  currentTimeRef: MutableRefObject<number>;
  isPlaying: boolean;
  isVisible: boolean;
  useAmlLyrics: boolean;
  fontSize: number;
  lineSpacing: number;
  inactiveBlur: number;
  scale: number;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  onSeek: (time: number) => void;
}

/** Mount exactly one lyric renderer. The AMLL runtime stays in its lazy chunk. */
export default function FocusLyrics({
  track,
  currentTime,
  currentTimeRef,
  isPlaying,
  isVisible,
  useAmlLyrics,
  fontSize,
  lineSpacing,
  inactiveBlur,
  scale,
  textPrimary,
  textSecondary,
  textMuted,
  onSeek,
}: FocusLyricsProps) {
  if (!track || !hasTrackLyrics(track)) return null;

  if (!useAmlLyrics) {
    return (
      <FocusLegacyLyrics
        track={track}
        currentTime={currentTime}
        currentTimeRef={currentTimeRef}
        isPlaying={isPlaying}
        isVisible={isVisible}
        fontSize={fontSize}
        lineSpacing={lineSpacing}
        inactiveBlur={inactiveBlur}
        scale={scale}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
        textMuted={textMuted}
        onSeek={onSeek}
      />
    );
  }

  return (
    <div
      className="flex-1 h-full min-w-0 max-h-[50vh] lg:max-h-[60vh] overflow-hidden relative px-8 select-none"
      style={scale > 1 ? {
        paddingLeft: `${32 * scale}px`,
        paddingRight: `${32 * scale}px`,
      } : undefined}
      data-testid="focus-amll-lyrics"
    >
      <Suspense fallback={<div className="h-full" aria-hidden="true" />}>
        <FocusAmlLyrics
          track={track}
          currentTime={currentTime}
          isPlaying={isPlaying}
          isVisible={isVisible}
          fontSize={fontSize}
          lineSpacing={lineSpacing}
          inactiveBlur={inactiveBlur}
          onSeek={onSeek}
        />
      </Suspense>
    </div>
  );
}
