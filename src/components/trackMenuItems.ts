import type { SlotId } from '../types';
import type { OnlineQuality } from '../services/onlineMusicProvider';

export const TRACK_DOWNLOAD_QUALITIES = ['128', '320', 'flac'] as const satisfies readonly OnlineQuality[];
export type TrackDownloadQuality = typeof TRACK_DOWNLOAD_QUALITIES[number];

export type TrackMenuActionId =
  | 'edit'
  | 'select'
  | 'remove'
  | `download:${TrackDownloadQuality}`;

export type TrackMenuItem =
  | {
    kind: 'action';
    id: TrackMenuActionId;
    labelKey?: string;
    label?: string;
    /** Prefixes the accessible name, e.g. "Download 320kbps". */
    groupLabelKey?: string;
    danger?: boolean;
  }
  | { kind: 'label'; labelKey: string }
  | { kind: 'separator' };

/** Where the list lives: a library slot, or the global search results. */
export type TrackMenuSource = SlotId | 'search';

interface TrackMenuContext {
  dataSource: TrackMenuSource;
  /** Metadata editing is wired for this list. */
  canEdit: boolean;
  /** The track resolves to an online provider song. */
  canDownload: boolean;
}

const QUALITY_LABELS: Record<TrackDownloadQuality, string> = {
  '128': '128kbps',
  '320': '320kbps',
  flac: 'FLAC',
};

/**
 * Decides which song actions a list offers. Local and online-queue lists are
 * managed by the library; platform playlists and search results are play-only,
 * so they only get download. Cloud lists are managed by their remote source.
 */
export function buildTrackMenuItems({ dataSource, canEdit, canDownload }: TrackMenuContext): TrackMenuItem[] {
  const groups: TrackMenuItem[][] = [];
  if (canDownload && dataSource !== 'local' && dataSource !== 'cloud') {
    groups.push([
      { kind: 'label', labelKey: 'browse.download' },
      ...TRACK_DOWNLOAD_QUALITIES.map(quality => ({
        kind: 'action' as const,
        id: `download:${quality}` as const,
        label: QUALITY_LABELS[quality],
        groupLabelKey: 'browse.download',
      })),
    ]);
  }
  if (dataSource === 'local' || dataSource === 'online') {
    groups.push([
      ...(canEdit ? [{ kind: 'action' as const, id: 'edit' as const, labelKey: 'library.editInfo' }] : []),
      { kind: 'action', id: 'select', labelKey: 'library.selectMultiple' },
    ]);
    groups.push([{ kind: 'action', id: 'remove', labelKey: 'library.remove', danger: true }]);
  }
  return groups.flatMap((group, index) => (index === 0 ? group : [{ kind: 'separator' as const }, ...group]));
}

/** The quality a download action requests, or null for non-download actions. */
export function downloadQualityOf(id: TrackMenuActionId): TrackDownloadQuality | null {
  return id.startsWith('download:') ? id.slice('download:'.length) as TrackDownloadQuality : null;
}
