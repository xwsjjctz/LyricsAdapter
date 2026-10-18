import { lazy, Suspense, type MutableRefObject } from 'react';
import type { Track } from '../../types';
import FocusLegacyLyrics from './FocusLegacyLyrics';
import { hasTrackLyrics } from './focusLyricsTrack';
import './FocusLyrics.css';

const FocusAmlLyrics = lazy(() => import('./FocusAmlLyrics'));
const NO_TRANSLATIONS: Readonly<Record<string, string>> = {};

export interface FocusLyricsProps {
  track: Track | null;
  /** Plugin translations by lyric line ID. Renderers rebuild whenever this object changes. */
  translations?: Readonly<Record<string, string>>;
  currentTime: number;
  currentTimeRef: MutableRefObject<number>;
  isPlaying: boolean;
  isVisible: boolean;
  useAmlLyrics: boolean;
  portrait?: boolean;
  fontSize: number;
  lineSpacing: number;
  inactiveBlur: number;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  onSeek: (time: number) => void;
}

/** Mount exactly one lyric renderer. The AMLL runtime stays in its lazy chunk. */
export default function FocusLyrics({
  track,
  translations = NO_TRANSLATIONS,
  currentTime,
  currentTimeRef,
  isPlaying,
  isVisible,
  useAmlLyrics,
  portrait = false,
  fontSize,
  lineSpacing,
  inactiveBlur,
  textPrimary,
  textSecondary,
  textMuted,
  onSeek,
}: FocusLyricsProps) {
  if (!track || !hasTrackLyrics(track)) return null;

  return (
    <div
      className="focus-lyrics-viewport flex-1 h-full min-h-0 min-w-0 max-h-[50vh] lg:max-h-[60vh] overflow-hidden relative px-8 select-none"
      data-testid={useAmlLyrics ? 'focus-amll-lyrics' : undefined}
    >
      {!useAmlLyrics ? (
        <FocusLegacyLyrics
          track={track}
          translations={translations}
          currentTime={currentTime}
          currentTimeRef={currentTimeRef}
          isPlaying={isPlaying}
          isVisible={isVisible}
          portrait={portrait}
          fontSize={fontSize}
          lineSpacing={lineSpacing}
          inactiveBlur={inactiveBlur}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
          textMuted={textMuted}
          onSeek={onSeek}
        />
      ) : (
        <Suspense fallback={<div className="h-full" aria-hidden="true" />}>
          <FocusAmlLyrics
            track={track}
            translations={translations}
            currentTime={currentTime}
            isPlaying={isPlaying}
            isVisible={isVisible}
            portrait={portrait}
            fontSize={fontSize}
            lineSpacing={lineSpacing}
            inactiveBlur={inactiveBlur}
            onSeek={onSeek}
          />
        </Suspense>
      )}
    </div>
  );
}
