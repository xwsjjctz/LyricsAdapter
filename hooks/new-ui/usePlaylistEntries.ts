import { useMemo } from 'react';
import type { SlotId } from '../../types';
import { i18n } from '../../services/i18n';
import type { LibrarySlotsById, PlaylistEntry } from '../../components/new-ui/types';

const SLOT_ORDER: SlotId[] = ['local', 'cloud', 'online'];

const SLOT_ICONS: Record<SlotId, string> = {
  local: 'hard_drive',
  cloud: 'cloud',
  online: 'play_circle',
};

function getSlotTitle(slotId: SlotId): string {
  if (slotId === 'local') return i18n.t('sidebar.local');
  if (slotId === 'cloud') return i18n.t('sidebar.cloud');
  return i18n.t('sidebar.onlinePlayback');
}

function getSlotSubtitle(slotId: SlotId, count: number): string {
  if (slotId === 'local') return count > 0 ? `${count} local tracks` : i18n.t('mainPlayer.importTracks');
  if (slotId === 'cloud') return count > 0 ? `${count} cloud tracks` : i18n.t('sidebar.cloud');
  return count > 0 ? `${count} streamed tracks` : i18n.t('sidebar.onlinePlayback');
}

export function usePlaylistEntries(slots: LibrarySlotsById): PlaylistEntry[] {
  return useMemo(() => SLOT_ORDER.map((slotId) => {
    const tracks = slots[slotId].tracks;
    return {
      id: slotId,
      kind: slotId,
      title: getSlotTitle(slotId),
      subtitle: getSlotSubtitle(slotId, tracks.length),
      count: tracks.length,
      tracks,
      coverUrls: tracks.map(track => track.coverUrl).filter((coverUrl): coverUrl is string => Boolean(coverUrl)).slice(0, 3),
      icon: SLOT_ICONS[slotId],
    };
  }), [slots]);
}
