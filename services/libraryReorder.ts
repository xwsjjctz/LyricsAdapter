import type { Track } from '../types';

interface ReorderResult {
  tracks: Track[];
  currentTrackIndex: number;
  changed: boolean;
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
