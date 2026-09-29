import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlotId, Track } from '../types';
import { getDesktopAPI } from '../services/desktopAdapter';
import { useCurrentTheme } from './settings/shared';
import PosterWall from './wall/PosterWall';
import TrackMenu from './TrackMenu';
import ConfirmDialog from './ConfirmDialog';
import MetadataEditorPopup from './MetadataEditorPopup';
import type { TrackDownloadQuality } from './trackMenuItems';
import { useLibraryTrackActions } from '../hooks/useLibraryTrackActions';
import { useLibraryFileDrop } from '../hooks/useLibraryFileDrop';
import { MACOS_PLAYER_BOTTOM_INSET } from './playerLayout';
import WallSelectionBar from './wall/WallSelectionBar';
import WallStatusPill from './wall/WallStatusPill';

type Progress = { loaded: number; total: number } | null | undefined;


interface LibraryWallViewProps {
  tracks: Track[];
  /** Identity of the shown source; a change plays the wall's switch animation. */
  sourceKey: string;
  dataSource: SlotId;
  currentTrackId?: string | undefined;
  onTrackSelect: (index: number) => void;
  onRemoveTrack: (trackId: string) => void | Promise<void>;
  onRemoveMultipleTracks?: ((trackIds: string[]) => void | Promise<void>) | undefined;
  onUpdateTrack?: ((track: Track) => void) | undefined;
  onDownloadTrack?: ((track: Track, quality: TrackDownloadQuality) => void) | undefined;
  playlistLoading?: boolean;
  playlistHasMore?: boolean;
  playlistLoadError?: string | null;
  onLoadMorePlaylist?: (() => void | Promise<void>) | undefined;
  pendingLocateSlot?: SlotId | undefined;
  pendingLocateToken?: number | undefined;
  onPendingLocatePrepared?: ((token: number) => void) | undefined;
  /** Bumped on every track switch; the wall follows the playing tile out of view. */
  autoLocateToken?: number;
  /** This source's saved scroll offset and its reporter (not used for playlists). */
  savedScrollPosition?: number | undefined;
  onScrollPositionChange?: ((position: number) => void) | undefined;
  /** Pending palette "locate now playing" request, and its acknowledgement. */
  locateRequest?: number | null | undefined;
  onLocateRequestHandled?: ((token: number) => void) | undefined;
  /** Drag-to-swap; only offered for lists the library manages. */
  onSwapTracks?: ((firstIndex: number, secondIndex: number) => void) | undefined;
  importDisabled?: boolean;
  onImportClick?: (() => void) | undefined;
  onDropFiles?: ((files: File[]) => void) | undefined;
  onDropFilePaths?: ((filePaths: { path: string; name: string }[]) => void) | undefined;
  importProgress?: Progress;
  /** Cloud metadata loading progress. */
  loadProgress?: Progress;
  /** Bumped by the palette's "select" command to enter multi-select. */
  selectionRequest?: number | undefined;
}

/**
 * Full-window poster-wall presentation of a library source. The wall is a
 * song list: clicking plays in place. Mutations use the list's callbacks.
 */
const LibraryWallView: React.FC<LibraryWallViewProps> = ({
  tracks, sourceKey, dataSource, currentTrackId, onTrackSelect,
  onRemoveTrack, onRemoveMultipleTracks, onUpdateTrack, onDownloadTrack,
  playlistLoading = false, playlistHasMore = false, playlistLoadError = null, onLoadMorePlaylist,
  pendingLocateSlot, pendingLocateToken, onPendingLocatePrepared, autoLocateToken, locateRequest, onLocateRequestHandled,
  savedScrollPosition, onScrollPositionChange,
  onSwapTracks, importDisabled = true, onImportClick, onDropFiles, onDropFilePaths,
  importProgress, loadProgress, selectionRequest,
}) => {
  const { t } = useTranslation();
  const { colors } = useCurrentTheme();
  const desktop = getDesktopAPI();
  const isMac = desktop?.platform === 'darwin';
  const bottomInset = isMac ? MACOS_PLAYER_BOTTOM_INSET : 24;

  const actions = useLibraryTrackActions({
    tracks,
    listedTracks: tracks,
    dataSource,
    filterType: 'default',
    categorySelection: null,
    onRemoveTrack,
    onRemoveMultipleTracks,
    onUpdateTrack,
    onDownloadTrack,
  });

  const { menuItemsFor, startSelection } = actions;
  const hasMenu = useCallback((track: Track) => menuItemsFor(track).length > 0, [menuItemsFor]);

  // Library sources reopen where they were left. The playlist slot is shared
  // by every browsed playlist, so a playlist always opens at the top.
  const rememberScroll = dataSource === 'playlist'
    ? {}
    : { restoreScrollTop: savedScrollPosition, onScrollPositionChange };

  // A source switch made to locate jumps there; a palette request scrolls smoothly.
  const slotLocateToken = pendingLocateSlot === dataSource ? pendingLocateToken : undefined;
  const wallLocateRequest = useMemo(() => {
    if (slotLocateToken != null) return { token: slotLocateToken, smooth: false };
    return locateRequest != null ? { token: locateRequest, smooth: true } : undefined;
  }, [locateRequest, slotLocateToken]);
  // The wall only ever holds the request above, so its kind decides the ack.
  const handleWallLocateHandled = useCallback((token: number) => {
    if (slotLocateToken != null) onPendingLocatePrepared?.(token);
    else onLocateRequestHandled?.(token);
  }, [onLocateRequestHandled, onPendingLocatePrepared, slotLocateToken]);

  const loadMore = useCallback(() => { void onLoadMorePlaylist?.(); }, [onLoadMorePlaylist]);

  // Only lists the library manages can be selected or rearranged.
  const canManage = dataSource === 'local' || dataSource === 'online';
  const handledSelectionRequest = useRef(selectionRequest);
  useEffect(() => {
    if (selectionRequest === handledSelectionRequest.current) return;
    handledSelectionRequest.current = selectionRequest;
    if (canManage && tracks.length > 0) startSelection();
  }, [canManage, selectionRequest, startSelection, tracks.length]);

  const toggleSelect = useCallback((track: Track) => actions.toggleSelectOne(track.id), [actions.toggleSelectOne]);
  const swap = useCallback((first: number, second: number) => onSwapTracks?.(first, second), [onSwapTracks]);

  const fileDrop = useLibraryFileDrop({ importDisabled: importDisabled || dataSource !== 'local', onDropFiles, onDropFilePaths });
  const progress = importProgress ?? (dataSource === 'cloud' ? loadProgress : null);
  const progressLabel = importProgress
    ? `${t('library.importing')} ${importProgress.loaded}/${importProgress.total}`
    : progress ? `${t('library.loadingMetadata')}${progress.loaded}/${progress.total}` : '';

  const emptyAction = dataSource === 'local' && !importDisabled && onImportClick ? (
    <button type="button" className="wall-float wall-float__button wall-empty-action" onClick={onImportClick}>
      <span className="material-symbols-outlined" aria-hidden="true">library_add</span>
      {t('sidebar.importFiles')}
    </button>
  ) : undefined;

  return (
    <div
      className="library-wall-view relative flex h-full w-full flex-col"
      onDragOver={fileDrop.handleDragOver}
      onDragLeave={fileDrop.handleDragLeave}
      onDrop={event => { void fileDrop.handleDrop(event); }}
    >
      <PosterWall
        tracks={tracks}
        sourceKey={sourceKey}
        currentTrackId={currentTrackId}
        loading={playlistLoading}
        emptyLabel={dataSource === 'online' ? t('library.noOnlineTracks') : t('library.noTracksImported')}
        loadingLabel={t('common.loading')}
        hasMore={playlistHasMore}
        loadError={playlistLoadError !== null}
        onLoadMore={onLoadMorePlaylist ? loadMore : undefined}
        onTrackSelect={onTrackSelect}
        hasMenu={hasMenu}
        onOpenMenu={actions.openTrackMenu}
        emptyAction={emptyAction}
        selecting={actions.isSelecting}
        selectedIds={actions.selectedIds}
        onToggleSelect={toggleSelect}
        onSwap={canManage && onSwapTracks ? swap : undefined}
        autoLocateToken={autoLocateToken}
        locateRequest={wallLocateRequest}
        onLocateRequestHandled={handleWallLocateHandled}
        bottomInset={bottomInset}
        {...rememberScroll}
      />

      {progress && <WallStatusPill label={progressLabel} progress={progress.total > 0 ? progress.loaded / progress.total : undefined} />}

      {fileDrop.isDragging && (
        <div className="wall-drop-overlay" aria-hidden="true">
          <span className="material-symbols-outlined">upload_file</span>
          <p className="wall-drop-overlay__title">{t('library.dropFiles')}</p>
          <p className="wall-drop-overlay__hint">{t('library.supportFormats')}</p>
        </div>
      )}

      {actions.isSelecting && (
        <WallSelectionBar
          count={actions.selectedIds.size}
          total={tracks.length}
          bottom={bottomInset + 16}
          onToggleAll={actions.toggleSelectAll}
          onRemove={actions.requestBatchDelete}
          onDone={actions.finishSelection}
        />
      )}

      {actions.trackMenu && actions.menuTrack && !actions.isSelecting && (
        <TrackMenu
          position={actions.trackMenu}
          colors={colors}
          items={menuItemsFor(actions.menuTrack)}
          onClose={actions.closeTrackMenu}
          onAction={id => actions.handleTrackMenuAction(actions.menuTrack!, id)}
        />
      )}

      <ConfirmDialog
        isOpen={actions.deleteConfirm !== null}
        title={t('library.removeConfirmTitle')}
        message={actions.deleteConfirm === 'batch'
          ? t('library.removeSelectedConfirmMessage', { count: actions.selectedIds.size })
          : t('library.removeConfirmMessage')}
        confirmLabel={t('library.remove')}
        busy={actions.isRemoving}
        error={actions.removalError ? t('library.removalFailed') : null}
        onConfirm={actions.confirmDelete}
        onCancel={actions.cancelDelete}
      />

      {actions.editingTrack && (
        <MetadataEditorPopup
          track={actions.editingTrack}
          isOpen={actions.isMetadataEditorOpen}
          onUpdateTrack={updated => onUpdateTrack?.(updated)}
          onClose={actions.closeMetadataEditor}
          onExited={actions.clearEditingTrack}
        />
      )}

      {dataSource === 'playlist' && playlistLoadError && (
        <p role="alert" className="absolute left-1/2 -translate-x-1/2 r-control px-3 py-2 text-xs shadow-lg"
          style={{ bottom: bottomInset + 12, backgroundColor: colors.backgroundCard, color: colors.error }}>
          {playlistLoadError}
        </p>
      )}
    </div>
  );
};

export default LibraryWallView;
