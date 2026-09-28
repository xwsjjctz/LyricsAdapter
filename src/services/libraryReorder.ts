import type { Track } from '../types';

interface ReorderResult {
  tracks: Track[];
  currentTrackIndex: number;
  changed: boolean;
}

/**
 * Exchange two tracks' positions. The poster wall keeps every tile's size and
 * place, so a drag only trades which songs the two tiles show.
 */
export function swapTracks(
  tracks: Track[],
  currentTrackIndex: number,
  firstIndex: number,
  secondIndex: number
): ReorderResult {
  const first = tracks[firstIndex];
  const second = tracks[secondIndex];
  if (!first || !second || firstIndex === secondIndex) {
    return { tracks, currentTrackIndex, changed: false };
  }
  const swapped = tracks.map((track, index) => {
    if (index === firstIndex) return second;
    if (index === secondIndex) return first;
    return track;
  });
  const nextCurrentTrackIndex = currentTrackIndex === firstIndex
    ? secondIndex
    : currentTrackIndex === secondIndex ? firstIndex : currentTrackIndex;
  return { tracks: swapped, currentTrackIndex: nextCurrentTrackIndex, changed: true };
}

export function reorderTracks(
  tracks: Track[],
  currentTrackIndex: number,
  fromIndex: number,
  toIndex: number
): ReorderResult {
  if (
    fromIndex < 0 ||
    fromIndex >= tracks.length ||
    toIndex < 0 ||
    toIndex > tracks.length ||
    fromIndex === toIndex
  ) {
    return { tracks, currentTrackIndex, changed: false };
  }

  const reordered = [...tracks];
  const [movedTrack] = reordered.splice(fromIndex, 1);
  if (!movedTrack) {
    return { tracks, currentTrackIndex, changed: false };
  }

  const adjustedToIndex = Math.max(
    0,
    Math.min(toIndex > fromIndex ? toIndex - 1 : toIndex, reordered.length)
  );

  if (adjustedToIndex === fromIndex) {
    return { tracks, currentTrackIndex, changed: false };
  }

  reordered.splice(adjustedToIndex, 0, movedTrack);

  const currentTrackId = tracks[currentTrackIndex]?.id;
  const nextCurrentTrackIndex = currentTrackId
    ? reordered.findIndex(track => track.id === currentTrackId)
    : currentTrackIndex;

  return {
    tracks: reordered,
    currentTrackIndex: nextCurrentTrackIndex,
    changed: true,
  };
}
