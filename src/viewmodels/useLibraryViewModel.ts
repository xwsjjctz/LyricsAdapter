import type { LibrarySlot, SlotId, Track } from '../types';
import { i18n } from '../services/i18n';

/**
 * Library-facing ViewModel (Phase 4 of the refactor roadmap, §6.4).
 *
 * Repackages the library store + the two controllers into the shape UI
 * consumes, so AppWorkspace can hand both shells (Legacy + NewUx) a single
 * `library` object instead of threading slots / activeSlotId / viewSlot / the
 * mutation callbacks separately.
 *
 * Crucially this VM does NOT expose `updateSlot`, `setActiveTracks`, or any
 * slot-implementation detail (roadmap §6.4: "UI 不需要知道 current slot
 * implementation"). Mutations go through the controller surface only.
 *
 * Legacy-only mechanisms (filterType / categorySelection / scrollPosition /
 * autoLocateToken / the pendingSlotLocate protocol / loadCloudTracks) stay as
 * extra props on LibraryView itself — they are presentation mechanisms the VM
 * is meant to hide, not part of the shared library contract.
 */

export interface LibraryViewModel {
  // ---- state reads ----
  slots: Record<SlotId, LibrarySlot>;
  activeSlotId: SlotId;
  viewSlot: SlotId;
  /** Cloud-slot import affordance: disabled when cloud is read-only or still probing. */
  cloudImportDisabled: boolean;
  /** Always set (probing / read-only label) — mirrors the previous inline derivation. */
  cloudImportDisabledReason: string;

  // ---- intent callbacks ----
  /** Switch the slot the library panel is browsing. */
  switchViewSlot(slotId: SlotId, options?: { locateCurrentTrack?: boolean }): Promise<void>;
  /** Play a track; optional slotId override for cross-context playback (New UI). */
  selectTrack(index: number, slotId?: SlotId): void;
  removeTrack(trackId: string, deleteFile?: boolean): Promise<void>;
  removeTracks(trackIds: string[], deleteFile?: boolean): Promise<void>;
  reorder(fromIndex: number, toIndex: number): Promise<void>;
  updateTrack(track: Track): void;
}

export interface LibraryViewModelOptions {
  slots: Record<SlotId, LibrarySlot>;
  activeSlotId: SlotId;
  viewSlot: SlotId;
  /** null = still probing, true = writable, false = read-only. */
  cloudWritable: boolean | null;
  /** Library store slot switcher (handleSwitchSlot). */
  switchViewSlot: (slotId: SlotId, options?: { locateCurrentTrack?: boolean }) => Promise<void>;
  /** Player controller's track-select (handles same-slot + cross-slot play). */
  selectTrack: (index: number, slotId?: SlotId) => void;
  /** Library controller mutations. */
  removeTrack: (trackId: string, deleteFile?: boolean) => Promise<void>;
  removeTracks: (trackIds: string[], deleteFile?: boolean) => Promise<void>;
  reorder: (fromIndex: number, toIndex: number) => Promise<void>;
  updateTrack: (track: Track) => void;
}

export function useLibraryViewModel(opts: LibraryViewModelOptions): LibraryViewModel {
  const {
    slots,
    activeSlotId,
    viewSlot,
    cloudWritable,
    switchViewSlot,
    selectTrack,
    removeTrack,
    removeTracks,
    reorder,
    updateTrack,
  } = opts;

  return {
    slots,
    activeSlotId,
    viewSlot,
    cloudImportDisabled: cloudWritable !== true,
    cloudImportDisabledReason:
      cloudWritable === null
        ? i18n.t('sidebar.importChecking')
        : i18n.t('sidebar.importReadOnly'),
    switchViewSlot,
    selectTrack,
    removeTrack,
    removeTracks,
    reorder,
    updateTrack,
  };
}
