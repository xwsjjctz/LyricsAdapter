import { useMemo } from 'react';
import type { SlotId, Track } from '../../types';
import type { CardEntry } from '../../components/new-ui/types';
import type { LibrarySlotsById } from '../../components/new-ui/types';

interface UseNowPlayingLocatorOptions {
  entries: CardEntry[];
  slots: LibrarySlotsById;
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
  slots,
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

    // A slot card "contains" the current track when its slot's tracks include
    // the track id. Only slot-backed cards hold tracks; overlay / online-playlist
    // cards are skipped (they have no browsable track list).
    const slotContainsTrack = (entry: CardEntry & { kind: 'slot' }): boolean =>
      slots[entry.slotId].tracks.some(track => track.id === currentTrack.id);

    const slotCards = entries.filter((entry): entry is CardEntry & { kind: 'slot' } => entry.kind === 'slot');
    const activeEntry = slotCards.find(entry => entry.slotId === activeSlotId && slotContainsTrack(entry));
    const entryByTrack = slotCards.find(entry => slotContainsTrack(entry));
    const fallbackEntry = slotCards.find(entry => entry.slotId === inferSlotId(currentTrack)) ?? null;
    const targetEntry = activeEntry ?? entryByTrack ?? fallbackEntry;

    if (!targetEntry) {
      return {
        visible: false,
        targetEntry: null,
        targetTrackId: null,
      };
    }

    // openPlaylistId is the slot id of the currently open panel (or null). The
    // locate button hides when the open panel already shows the current track.
    const isOpenTarget = openPlaylistId === targetEntry.slotId;

    return {
      visible: !isOpenTarget || !isCurrentTrackVisible,
      targetEntry,
      targetTrackId: currentTrack.id,
    };
  }, [activeSlotId, currentTrack, entries, isCurrentTrackVisible, openPlaylistId, slots]);
}
