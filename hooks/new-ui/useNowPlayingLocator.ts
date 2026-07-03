import { useMemo } from 'react';
import type { SlotId, Track } from '../../types';
import type { PlaylistEntry } from '../../components/new-ui/types';

interface UseNowPlayingLocatorOptions {
  entries: PlaylistEntry[];
  currentTrack: Track | null;
  activeSlotId: SlotId;
  openPlaylistId: SlotId | null;
  isCurrentTrackVisible: boolean;
}

function inferSlotId(track: Track): SlotId {
  if (track.source === 'webdav') return 'cloud';
  if (track.source === 'qq' || track.source === 'netease') return 'online';
  return 'local';
}

export function useNowPlayingLocator({
  entries,
  currentTrack,
  activeSlotId,
  openPlaylistId,
  isCurrentTrackVisible,
}: UseNowPlayingLocatorOptions) {
  return useMemo(() => {
    if (!currentTrack) {
      return {
        visible: false,
        targetEntry: null,
        targetTrackId: null,
      };
    }

    const activeEntry = entries.find(entry => entry.id === activeSlotId && entry.tracks.some(track => track.id === currentTrack.id));
    const entryByTrack = entries.find(entry => entry.tracks.some(track => track.id === currentTrack.id));
    const fallbackEntry = entries.find(entry => entry.id === inferSlotId(currentTrack)) ?? null;
    const targetEntry = activeEntry ?? entryByTrack ?? fallbackEntry;

    if (!targetEntry) {
      return {
        visible: false,
        targetEntry: null,
        targetTrackId: null,
      };
    }

    const isOpenTarget = openPlaylistId === targetEntry.id;

    return {
      visible: !isOpenTarget || !isCurrentTrackVisible,
      targetEntry,
      targetTrackId: currentTrack.id,
    };
  }, [activeSlotId, currentTrack, entries, isCurrentTrackVisible, openPlaylistId]);
}
