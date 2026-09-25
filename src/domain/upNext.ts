import type { Track } from '../types';

export type UpNextMode = 'order' | 'shuffle' | 'repeat-one';

export interface UpNextEntry {
  track: Track;
  /** Index within the playing list, for selecting it. */
  index: number;
}

export interface UpNext {
  current: Track | null;
  upcoming: UpNextEntry[];
  mode: UpNextMode;
}

/**
 * What plays after the current track, mirroring usePlayback's forward rule:
 * order mode advances and wraps; shuffle picks at random and repeat-one
 * replays, so neither has a predictable list.
 */
export function buildUpNext(tracks: Track[], currentIndex: number, mode: UpNextMode, limit: number): UpNext {
  const current = tracks[currentIndex] ?? null;
  if (!current || mode !== 'order') return { current, upcoming: [], mode };

  const count = Math.min(limit, tracks.length - 1);
  const upcoming = Array.from({ length: Math.max(0, count) }, (_, offset) => {
    const index = (currentIndex + offset + 1) % tracks.length;
    return { track: tracks[index]!, index };
  });
  return { current, upcoming, mode };
}
