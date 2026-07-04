import { useCallback, useMemo, useState } from 'react';
import type { SlotId } from '../../types';

interface TrackMenuState {
  trackId: string;
  trackIndex: number;
  x: number;
  y: number;
}

interface DeleteState {
  trackIds: string[];
}

export interface NewUxPanelState {
  openPlaylistId: SlotId | null;
  isEditMode: boolean;
  selectedTrackIds: Set<string>;
  editingTrackId: string | null;
  deleteTargetIds: string[];
  trackMenu: TrackMenuState | null;
  /** Overlay panel (settings/theme) shown instead of a playlist panel. Mutually
   *  exclusive with openPlaylistId: opening one closes the other. */
  openOverlayPanel: 'settings' | 'theme' | null;
}

export function useNewUxPanels() {
  const [openPlaylistId, setOpenPlaylistId] = useState<SlotId | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null);
  const [openOverlayPanel, setOpenOverlayPanel] = useState<'settings' | 'theme' | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedTrackIds(new Set());
  }, []);

  const openPlaylist = useCallback((playlistId: SlotId) => {
    setOpenPlaylistId(playlistId);
    setOpenOverlayPanel(null);
    setTrackMenu(null);
    setEditingTrackId(null);
    setDeleteState(null);
  }, []);

  const closePlaylist = useCallback(() => {
    setOpenPlaylistId(null);
    setTrackMenu(null);
    setEditingTrackId(null);
    setDeleteState(null);
    setIsEditMode(false);
    clearSelection();
  }, [clearSelection]);

  const openSettings = useCallback(() => {
    setOpenOverlayPanel('settings');
    closePlaylist();
  }, [closePlaylist]);

  const openTheme = useCallback(() => {
    setOpenOverlayPanel('theme');
    closePlaylist();
  }, [closePlaylist]);

  const closeOverlay = useCallback(() => {
    setOpenOverlayPanel(null);
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
    setEditingTrackId(trackId);
    setTrackMenu(null);
  }, []);

  const closeMetadata = useCallback(() => {
    setEditingTrackId(null);
  }, []);

  const openDeleteConfirm = useCallback((trackIds: string[]) => {
    setDeleteState({ trackIds });
    setTrackMenu(null);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    setDeleteState(null);
  }, []);

  const state = useMemo<NewUxPanelState>(() => ({
    openPlaylistId,
    isEditMode,
    selectedTrackIds,
    editingTrackId,
    deleteTargetIds: deleteState?.trackIds ?? [],
    trackMenu,
    openOverlayPanel,
  }), [deleteState, editingTrackId, isEditMode, openPlaylistId, openOverlayPanel, selectedTrackIds, trackMenu]);

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
