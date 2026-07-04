import { useMemo } from 'react';
import type { SlotId } from '../../types';
import { i18n } from '../../services/i18n';
import type { LibrarySlotsById, PlaylistEntry } from '../../components/new-ui/types';

const SLOT_ORDER: SlotId[] = ['local', 'cloud', 'playlist', 'online'];

const SLOT_ICONS: Record<SlotId, string> = {
  local: 'hard_drive',
  cloud: 'cloud',
  online: 'play_circle',
  playlist: 'queue_music',
};

function getSlotTitle(slotId: SlotId): string {
  if (slotId === 'local') return i18n.t('sidebar.local');
  if (slotId === 'cloud') return i18n.t('sidebar.cloud');
  if (slotId === 'playlist') return i18n.t('sidebar.playlists');
  return i18n.t('sidebar.onlinePlayback');
}

function getSlotSubtitle(slotId: SlotId, count: number): string {
  if (slotId === 'local') return count > 0 ? `${count} local tracks` : i18n.t('mainPlayer.importTracks');
  if (slotId === 'cloud') return count > 0 ? `${count} cloud tracks` : i18n.t('sidebar.cloud');
  if (slotId === 'playlist') return count > 0 ? `${count} playlist tracks` : i18n.t('sidebar.playlists');
  return count > 0 ? `${count} streamed tracks` : i18n.t('sidebar.onlinePlayback');
}

export function usePlaylistEntries(slots: LibrarySlotsById): PlaylistEntry[] {
  return useMemo(() => {
    const slotEntries: PlaylistEntry[] = SLOT_ORDER
      .filter(slotId => slotId !== 'playlist' || slots.playlist.tracks.length > 0)
      .map((slotId) => {
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
      });

    // Overlay cards (settings / theme) sit alongside the library cards so the
    // user reaches them from the same card wall.
    const overlayEntries: PlaylistEntry[] = [
      {
        id: 'overlay-settings',
        kind: 'settings',
        title: i18n.t('settings.title'),
        subtitle: i18n.t('settings.description'),
        count: 0,
        tracks: [],
        coverUrls: [],
        icon: 'settings',
      },
      {
        id: 'overlay-theme',
        kind: 'theme',
        title: i18n.t('theme.title'),
        subtitle: i18n.t('theme.description'),
        count: 0,
        tracks: [],
        coverUrls: [],
        icon: 'palette',
      },
    ];

    return [...slotEntries, ...overlayEntries];
  }, [slots]);
}
