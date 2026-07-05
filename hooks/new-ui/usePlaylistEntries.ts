import { useMemo } from 'react';
import type { SlotId } from '../../types';
import { i18n } from '../../services/i18n';
import type { PlaylistInfo } from '../../services/onlineMusicProvider';
import type { CardEntry, CardMeta, LibrarySlotsById } from '../../components/new-ui/types';

const SLOT_ORDER: SlotId[] = ['local', 'cloud', 'online'];

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

const SOURCE_LABELS: Record<'qq' | 'netease', string> = {
  qq: i18n.t('settingsDialog.onlineSourceQq'),
  netease: i18n.t('settingsDialog.onlineSourceNetease'),
};

/** Collect up to `n` cover URLs from a slot's tracks (for the cover collage). */
function takeCovers(tracks: readonly { coverUrl?: string | undefined }[], n: number): string[] {
  return tracks
    .map(track => track.coverUrl)
    .filter((coverUrl): coverUrl is string => Boolean(coverUrl))
    .slice(0, n);
}

export function usePlaylistEntries(slots: LibrarySlotsById, onlinePlaylists: PlaylistInfo[] = []): CardEntry[] {
  return useMemo(() => {
    // Slot-backed cards (local/cloud/online). Cover collage comes from the
    // slot's tracks; the tracks themselves are NOT embedded in the card.
    const slotEntries: CardEntry[] = SLOT_ORDER.map(slotId => {
      const tracks = slots[slotId].tracks;
      const meta: CardMeta = {
        id: slotId,
        title: getSlotTitle(slotId),
        subtitle: getSlotSubtitle(slotId, tracks.length),
        icon: SLOT_ICONS[slotId],
        coverUrls: takeCovers(tracks, 3),
      };
      return { kind: 'slot', slotId, ...meta };
    });

    // Third-party (QQ/NetEase) playlists each become their own card.
    const playlistInfoEntries: CardEntry[] = onlinePlaylists.map(p => {
      const meta: CardMeta = {
        id: `playlist-info-${p.source}-${p.id}`,
        title: p.name,
        subtitle: `${p.songCount} · ${SOURCE_LABELS[p.source]}`,
        icon: 'queue_music',
        coverUrls: p.coverUrl ? [p.coverUrl] : [],
      };
      return { kind: 'online-playlist', source: p.source, playlistId: p.id, ...meta };
    });

    return [...slotEntries, ...playlistInfoEntries];
  }, [slots, onlinePlaylists]);
}
