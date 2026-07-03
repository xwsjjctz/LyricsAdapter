import type { LibrarySlot, SlotId, Track } from '../../types';

export type PlaylistEntryKind = SlotId;

export interface PlaylistEntry {
  id: SlotId;
  kind: PlaylistEntryKind;
  title: string;
  subtitle: string;
  count: number;
  tracks: Track[];
  coverUrls: string[];
  icon: string;
}

export type LibrarySlotsById = Record<SlotId, LibrarySlot>;
