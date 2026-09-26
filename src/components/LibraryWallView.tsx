import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlotId, Track } from '../types';
import { getDesktopAPI } from '../services/desktopAdapter';
import { useCurrentTheme } from './settings/shared';
import LibraryToolbar from './LibraryToolbar';
import PosterWall from './wall/PosterWall';
import TrackMenu from './TrackMenu';
import ConfirmDialog from './ConfirmDialog';
import MetadataEditorPopup from './MetadataEditorPopup';
import type { TrackDownloadQuality, TrackMenuItem } from './trackMenuItems';
import { useLibraryTrackActions } from '../hooks/useLibraryTrackActions';
import { useLibraryFileDrop } from '../hooks/useLibraryFileDrop';
import { MACOS_PLAYER_BOTTOM_INSET } from './playerLayout';

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
  onImportClick?: (() => void) | undefined;
  importDisabled?: boolean;
  importProgress?: { loaded: number; total: number } | null | undefined;
  onDropFiles?: ((files: File[]) => void) | undefined;
  onDropFilePaths?: ((filePaths: { path: string; name: string }[]) => void) | undefined;
  playlistTitle?: string | undefined;
  playlistTrackCount?: number | undefined;
  playlistLoading?: boolean;
  playlistHasMore?: boolean;
  playlistLoadError?: string | null;
  onLoadMorePlaylist?: (() => void | Promise<void>) | undefined;
  onPlayAll?: (() => void) | undefined;
  onShuffleAll?: (() => void) | undefined;
  pendingLocateSlot?: SlotId | undefined;
  pendingLocateToken?: number | undefined;
  onPendingLocatePrepared?: ((token: number) => void) | undefined;
  searchBox?: React.ReactNode;
  heading?: React.ReactNode;
  extraActions?: React.ReactNode;
}

/** Multi-select lives in the list layout; the wall menu omits it. */
const withoutSelect = (items: TrackMenuItem[]): TrackMenuItem[] => {
  const kept = items.filter(item => !(item.kind === 'action' && item.id === 'select'));
  return kept.filter((item, index) => item.kind !== 'separator'
    || (index > 0 && index < kept.length - 1 && kept[index - 1]!.kind !== 'separator'));
};

/** Poster-wall presentation of a library source; mutations go through the same callbacks as the list. */
const LibraryWallView: React.FC<LibraryWallViewProps> = ({
  tracks, sourceKey, dataSource, currentTrackId, onTrackSelect,
  onRemoveTrack, onRemoveMultipleTracks, onUpdateTrack, onDownloadTrack,
  onImportClick, importDisabled = false, importProgress, onDropFiles, onDropFilePaths,
  playlistTitle, playlistTrackCount, playlistLoading = false, playlistHasMore = false,
  playlistLoadError = null, onLoadMorePlaylist, onPlayAll, onShuffleAll,
  pendingLocateSlot, pendingLocateToken, onPendingLocatePrepared,
  searchBox, heading, extraActions,
}) => {
  const { t } = useTranslation();
  const { colors } = useCurrentTheme();
  const bottomInset = getDesktopAPI()?.platform === 'darwin' ? MACOS_PLAYER_BOTTOM_INSET : 24;

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
  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useLibraryFileDrop({
    importDisabled: importDisabled || dataSource !== 'local',
    onDropFiles,
    onDropFilePaths,
  });

  const menuItemsFor = useCallback(
    (track: Track) => withoutSelect(actions.menuItemsFor(track)),
    [actions.menuItemsFor],
  );
  const hasMenu = useCallback((track: Track) => menuItemsFor(track).length > 0, [menuItemsFor]);

  // The featured tile sits at the top, so "locate current track" is satisfied by the reset scroll.
  useEffect(() => {
    if (pendingLocateSlot === dataSource && pendingLocateToken != null) onPendingLocatePrepared?.(pendingLocateToken);
  }, [dataSource, onPendingLocatePrepared, pendingLocateSlot, pendingLocateToken]);

  const loadMore = useCallback(() => { void onLoadMorePlaylist?.(); }, [onLoadMorePlaylist]);

  return (
    <div
      className="library-view library-view--wall w-full flex flex-col h-full relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <LibraryToolbar
        dataSource={dataSource}
        colors={colors}
        {...(dataSource === 'local' && onImportClick ? { onImportClick, importDisabled } : {})}
        trackCount={tracks.length}
        {...(playlistTitle ? { playlistTitle } : {})}
        {...(playlistTrackCount != null ? { playlistTrackCount } : {})}
        importProgress={importProgress}
        searchBox={searchBox}
        onPlayAll={onPlayAll}
        onShuffleAll={onShuffleAll}
        heading={heading}
        extraActions={extraActions}
      />

      <PosterWall
        tracks={tracks}
        sourceKey={sourceKey}
        currentTrackId={currentTrackId}
        loading={playlistLoading}
        emptyLabel={dataSource === 'online' ? t('library.noOnlineTracks') : t('library.noTracksImported')}
        loadingLabel={t('common.loading')}
        hasMore={playlistHasMore}
        onLoadMore={onLoadMorePlaylist ? loadMore : undefined}
        bottomInset={bottomInset}
        onTrackSelect={onTrackSelect}
        hasMenu={hasMenu}
        onOpenMenu={actions.openTrackMenu}
      />

      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm r-surface border-2 border-dashed border-primary pointer-events-none">
          <p className="text-2xl font-bold text-primary">{t('library.dropFiles')}</p>
        </div>
      )}

      {actions.trackMenu && actions.menuTrack && (
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
        message={t('library.removeConfirmMessage')}
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
