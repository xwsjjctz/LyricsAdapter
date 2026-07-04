import { useCallback, useMemo, useState } from 'react';

/**
 * New UI panel state machine.
 *
 * The primary panel (none / playlist / overlay) is modeled as a discriminated
 * union so its mutual exclusion is enforced by the type system rather than by
 * manually resetting sibling states in every transition (which was the source
 * of several "stale panel" bugs). Sub-layers (metadata editor, delete-confirm)
 * only ever appear over a playlist panel; transient menus (track right-click,
 * edit-mode selection) are orthogonal and kept as independent fields.
 *
 * The exposed `state` shape and method names intentionally mirror the previous
 * `useNewUxPanels` API so consumers (NewUxShell) need not change.
 */

interface TrackMenuState {
  trackId: string;
  trackIndex: number;
  x: number;
  y: number;
}

/** Mutually exclusive top-level panel. */
export type PrimaryPanel =
  | { kind: 'none' }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'overlay'; overlay: 'settings' | 'theme' };

export interface NewUxPanelState {
  /** Open playlist panel's entry id (a SlotId or a `playlist-info-*` id), or null. */
  openPlaylistId: string | null;
  isEditMode: boolean;
  selectedTrackIds: Set<string>;
  /** Track whose metadata editor is open, overlaid on the playlist panel. */
  editingTrackId: string | null;
  /** Track ids targeted by the delete-confirmation overlay. Empty when closed. */
  deleteTargetIds: string[];
  /** Right-click track menu (floating, independent of the panel stack). */
  trackMenu: TrackMenuState | null;
  /** Overlay panel (settings/theme) shown instead of a playlist panel. */
  openOverlayPanel: 'settings' | 'theme' | null;
}

export function useNewUxStore() {
  // Primary panel — the single source of truth for which top-level panel is open.
  const [primary, setPrimary] = useState<PrimaryPanel>({ kind: 'none' });
  // Sub-layers that stack over a playlist panel.
  const [metadataTrackId, setMetadataTrackId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ trackIds: string[] } | null>(null);
  // Transient menus / selection.
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());

  const clearSelection = useCallback(() => {
    setSelectedTrackIds(new Set());
  }, []);

  const openPlaylist = useCallback((playlistId: string) => {
    // Switching the primary panel to a playlist clears every other panel-derived
    // sub-state. Overlay is dropped implicitly by the union; sub-layers and the
    // track menu are reset explicitly here.
    setPrimary({ kind: 'playlist', playlistId });
    setMetadataTrackId(null);
    setDeleteConfirm(null);
    setTrackMenu(null);
  }, []);

  const closePlaylist = useCallback(() => {
    setPrimary({ kind: 'none' });
    setMetadataTrackId(null);
    setDeleteConfirm(null);
    setTrackMenu(null);
    setIsEditMode(false);
    clearSelection();
  }, [clearSelection]);

  const openSettings = useCallback(() => {
    // Opening an overlay fully replaces the playlist context (mirrors the legacy
    // openSettings → closePlaylist sequence).
    setPrimary({ kind: 'overlay', overlay: 'settings' });
    setMetadataTrackId(null);
    setDeleteConfirm(null);
    setTrackMenu(null);
    setIsEditMode(false);
    clearSelection();
  }, [clearSelection]);

  const openTheme = useCallback(() => {
    setPrimary({ kind: 'overlay', overlay: 'theme' });
    setMetadataTrackId(null);
    setDeleteConfirm(null);
    setTrackMenu(null);
    setIsEditMode(false);
    clearSelection();
  }, [clearSelection]);

  const closeOverlay = useCallback(() => {
    setPrimary({ kind: 'none' });
  }, []);

  const enterEditMode = useCallback((initialTrackId?: string) => {
    setIsEditMode(true);
    setTrackMenu(null);
    if (initialTrackId) {
      setSelectedTrackIds(new Set([initialTrackId]));
    }
  }, []);

  const exitEditMode = useCallback(() => {
    setIsEditMode(false);
    clearSelection();
    setTrackMenu(null);
  }, [clearSelection]);

  const toggleTrackSelected = useCallback((trackId: string) => {
    setSelectedTrackIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }, []);

  const selectOnly = useCallback((trackId: string) => {
    setSelectedTrackIds(new Set([trackId]));
  }, []);

  const selectAll = useCallback((trackIds: string[]) => {
    setSelectedTrackIds(new Set(trackIds));
  }, []);

  const openTrackMenu = useCallback((menu: TrackMenuState) => {
    setTrackMenu(menu);
  }, []);

  const closeTrackMenu = useCallback(() => {
    setTrackMenu(null);
  }, []);

  const openMetadata = useCallback((trackId: string) => {
    setMetadataTrackId(trackId);
    setTrackMenu(null);
  }, []);

  const closeMetadata = useCallback(() => {
    setMetadataTrackId(null);
  }, []);

  const openDeleteConfirm = useCallback((trackIds: string[]) => {
    setDeleteConfirm({ trackIds });
    setTrackMenu(null);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirm(null);
  }, []);

  const state = useMemo<NewUxPanelState>(() => ({
    openPlaylistId: primary.kind === 'playlist' ? primary.playlistId : null,
    isEditMode,
    selectedTrackIds,
    editingTrackId: metadataTrackId,
    deleteTargetIds: deleteConfirm?.trackIds ?? [],
    trackMenu,
    openOverlayPanel: primary.kind === 'overlay' ? primary.overlay : null,
  }), [primary, isEditMode, selectedTrackIds, metadataTrackId, deleteConfirm, trackMenu]);

  return {
    state,
    openPlaylist,
    closePlaylist,
    enterEditMode,
    exitEditMode,
    toggleTrackSelected,
    selectOnly,
    selectAll,
    openTrackMenu,
    closeTrackMenu,
    openMetadata,
    closeMetadata,
    openDeleteConfirm,
    closeDeleteConfirm,
    clearSelection,
    openSettings,
    openTheme,
    closeOverlay,
  };
}
