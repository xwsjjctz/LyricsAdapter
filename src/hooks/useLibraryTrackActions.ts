import { useCallback, useEffect, useState } from 'react';
import type { SlotId, Track } from '../types';
import { logger } from '../services/logger';
import { trackToOnlineSong } from '../domain/trackFactory';
import type { TrackMenuPosition } from '../components/TrackMenu';
import {
  buildTrackMenuItems,
  downloadQualityOf,
  type TrackDownloadQuality,
  type TrackMenuActionId,
  type TrackMenuItem,
} from '../components/trackMenuItems';

interface UseLibraryTrackActionsOptions {
  /** Every track in the current slot; menu lookups resolve against it. */
  tracks: Track[];
  /** Tracks currently listed (after category filtering); selection is scoped to them. */
  listedTracks: Track[];
  dataSource: SlotId;
  filterType: 'default' | 'album' | 'artist';
  categorySelection: string | null;
  onRemoveTrack: (trackId: string) => void | Promise<void>;
  onRemoveMultipleTracks?: ((trackIds: string[]) => void | Promise<void>) | undefined;
  onUpdateTrack?: ((track: Track) => void) | undefined;
  onDownloadTrack?: ((track: Track, quality: TrackDownloadQuality) => void) | undefined;
}

export interface LibraryTrackActions {
  isSelecting: boolean;
  selectedIds: ReadonlySet<string>;
  toggleSelectAll: () => void;
  toggleSelectOne: (id: string) => void;
  finishSelection: () => void;
  trackMenu: TrackMenuPosition | null;
  menuTrack: Track | undefined;
  menuItemsFor: (track: Track) => TrackMenuItem[];
  openTrackMenu: (track: Track, x: number, y: number, trigger: HTMLElement) => void;
  closeTrackMenu: () => void;
  handleTrackMenuAction: (track: Track, id: TrackMenuActionId) => void;
  /** 'single' confirms the menu's track, 'batch' confirms the selection. */
  deleteConfirm: 'single' | 'batch' | null;
  requestBatchDelete: () => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
  isRemoving: boolean;
  removalError: boolean;
  editingTrack: Track | null;
  isMetadataEditorOpen: boolean;
  closeMetadataEditor: () => void;
  clearEditingTrack: () => void;
}

/**
 * Row-level intents of the library list: multi-select, the per-track context
 * menu, delete confirmation and the metadata editor. The list component only
 * renders; removals and edits still go through the library controller callbacks.
 */
export function useLibraryTrackActions({
  tracks,
  listedTracks,
  dataSource,
  filterType,
  categorySelection,
  onRemoveTrack,
  onRemoveMultipleTracks,
  onUpdateTrack,
  onDownloadTrack,
}: UseLibraryTrackActionsOptions): LibraryTrackActions {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [trackMenu, setTrackMenu] = useState<TrackMenuPosition | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<'single' | 'batch' | null>(null);
  const [trackToDelete, setTrackToDelete] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removalError, setRemovalError] = useState(false);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [isMetadataEditorOpen, setIsMetadataEditorOpen] = useState(false);

  const closeTrackMenu = useCallback(() => setTrackMenu(null), []);
  const finishSelection = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  // A different list invalidates the selection, the open menu and any pending confirm.
  useEffect(() => {
    finishSelection();
    closeTrackMenu();
    setDeleteConfirm(null);
  }, [dataSource, filterType, categorySelection, finishSelection, closeTrackMenu]);

  // Drop selected ids that are no longer listed.
  useEffect(() => {
    const available = new Set(listedTracks.map(track => track.id));
    setSelectedIds(previous => {
      const next = new Set([...previous].filter(id => available.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [listedTracks]);

  // Escape leaves selection mode unless a dialog above it consumed the key.
  useEffect(() => {
    if (!isSelecting || deleteConfirm || isMetadataEditorOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) finishSelection();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [isSelecting, deleteConfirm, isMetadataEditorOpen, finishSelection]);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(previous => (previous.size === listedTracks.length
      ? new Set()
      : new Set(listedTracks.map(track => track.id))));
  }, [listedTracks]);

  const toggleSelectOne = useCallback((id: string) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const menuTrack = trackMenu ? tracks.find(track => track.id === trackMenu.trackId) : undefined;
  const menuItemsFor = useCallback((track: Track) => buildTrackMenuItems({
    dataSource,
    canEdit: !!onUpdateTrack,
    canDownload: !!onDownloadTrack && trackToOnlineSong(track) !== null,
  }), [dataSource, onUpdateTrack, onDownloadTrack]);

  const openTrackMenu = useCallback((track: Track, x: number, y: number, trigger: HTMLElement) => {
    setTrackMenu({ trackId: track.id, x, y, trigger });
  }, []);

  const handleTrackMenuAction = useCallback((track: Track, id: TrackMenuActionId) => {
    if (id === 'edit') {
      setEditingTrack(track);
      setIsMetadataEditorOpen(true);
    } else if (id === 'select') {
      setSelectedIds(new Set([track.id]));
      setIsSelecting(true);
    } else if (id === 'remove') {
      setTrackToDelete(track.id);
      setRemovalError(false);
      setDeleteConfirm('single');
    } else {
      const quality = downloadQualityOf(id);
      if (quality) onDownloadTrack?.(track, quality);
    }
  }, [onDownloadTrack]);

  const requestBatchDelete = useCallback(() => {
    setRemovalError(false);
    setDeleteConfirm('batch');
  }, []);

  const cancelDelete = useCallback(() => {
    if (isRemoving) return;
    setDeleteConfirm(null);
    setTrackToDelete(null);
  }, [isRemoving]);

  const confirmDelete = useCallback(async () => {
    if (isRemoving || !deleteConfirm) return;
    const ids = deleteConfirm === 'single'
      ? (trackToDelete ? [trackToDelete] : [])
      : Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsRemoving(true);
    setRemovalError(false);
    try {
      if (deleteConfirm === 'single') await onRemoveTrack(ids[0]!);
      else if (onRemoveMultipleTracks) await onRemoveMultipleTracks(ids);
      else for (const id of ids) await onRemoveTrack(id);
      if (deleteConfirm === 'batch') finishSelection();
      setDeleteConfirm(null);
      setTrackToDelete(null);
    } catch (error) {
      logger.error('[LibraryView] Removal failed:', error);
      setRemovalError(true);
    } finally {
      setIsRemoving(false);
    }
  }, [deleteConfirm, finishSelection, isRemoving, onRemoveMultipleTracks, onRemoveTrack, selectedIds, trackToDelete]);

  const closeMetadataEditor = useCallback(() => setIsMetadataEditorOpen(false), []);
  const clearEditingTrack = useCallback(() => setEditingTrack(null), []);

  return {
    isSelecting,
    selectedIds,
    toggleSelectAll,
    toggleSelectOne,
    finishSelection,
    trackMenu,
    menuTrack,
    menuItemsFor,
    openTrackMenu,
    closeTrackMenu,
    handleTrackMenuAction,
    deleteConfirm,
    requestBatchDelete,
    cancelDelete,
    confirmDelete,
    isRemoving,
    removalError,
    editingTrack,
    isMetadataEditorOpen,
    closeMetadataEditor,
    clearEditingTrack,
  };
}
