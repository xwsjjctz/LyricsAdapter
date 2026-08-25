import type { Track } from '../../types';

export function hasTrackLyrics(track: Track | null): boolean {
  return Boolean(track?.syncedLyrics?.some((line) => line.text.trim()) || track?.lyrics?.trim());
}
