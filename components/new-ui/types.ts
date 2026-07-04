import type { LibrarySlot, SlotId, Track } from '../../types';

/** Slot-backed cards (local/cloud/playlist/online). */
export type PlaylistEntryKind = SlotId;
/** Third-party (QQ/NetEase) playlist cards. */
export type PlaylistInfoKind = 'playlist-info';
/** Non-track overlay cards (settings/theme). */
export type OverlayKind = 'settings' | 'theme';
export type AnyEntryKind = PlaylistEntryKind | PlaylistInfoKind | OverlayKind;

export interface PlaylistEntry {
  id: string;
  kind: AnyEntryKind;
  title: string;
  subtitle: string;
  count: number;
  tracks: Track[];
  coverUrls: string[];
  icon: string;
  /** Present only on playlist-info cards. */
  source?: 'qq' | 'netease';
  /** Present only on playlist-info cards (the third-party playlist id). */
  playlistId?: string;
}

export type LibrarySlotsById = Record<SlotId, LibrarySlot>;
