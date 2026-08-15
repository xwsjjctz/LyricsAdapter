import React, { type ReactElement, useCallback, useMemo } from 'react';
import { LibrarySlot, SlotId, Track, ViewMode } from '../types';
import { logger } from '../services/logger';
import type { OnlineSource } from '../services/onlineMusicProvider';
import TitleBar from './TitleBar';
import SidebarToggleButton from './SidebarToggleButton';
import Sidebar from './Sidebar';
import LibraryView from './LibraryView';
import BrowseView from './BrowseView';
import MetadataView from './MetadataView';
import FloatingPanel from './FloatingPanel';
import Controls from './Controls';
import FocusMode from './FocusMode';
import SearchBox from './SearchBox';
import SettingsPanel from './settings/SettingsPanel';
import ThemePanel from './settings/ThemePanel';
import GsapModal from './GsapModal';
import { useTranslation } from 'react-i18next';
import type { useUIStore } from '../stores/uiStore';
import type { useSidebarLayout } from '../hooks/useSidebarLayout';
import type { useLibraryViewModel } from '../viewmodels/useLibraryViewModel';
import type { usePlayerViewModel } from '../viewmodels/usePlayerViewModel';
import type { useImportViewModel } from '../viewmodels/useImportViewModel';
import type { useOnlineViewModel } from '../viewmodels/useOnlineViewModel';
import type { usePlayerController } from '../controllers/usePlayerController';

// The single application shell. AppWorkspace owns wiring while this component
// remains presentational; all state and user intents arrive via props.

interface AppShellProps {
  ui: ReturnType<typeof useUIStore>;
  sidebar: ReturnType<typeof useSidebarLayout>;
  library: ReturnType<typeof useLibraryViewModel>;
  player: ReturnType<typeof usePlayerViewModel>;
  importVm: ReturnType<typeof useImportViewModel>;
  online: ReturnType<typeof useOnlineViewModel>;
  playerController: ReturnType<typeof usePlayerController>;
  // Library-store fields consumed directly by the shell (not funnelled
  // through a viewmodel). Kept as explicit props to avoid coupling this
  // component to the store hook internals.
  slots: Record<SlotId, LibrarySlot>;
  activeTracks: Track[];
  viewSlot: SlotId;
  handleSwitchSlot: (slotId: SlotId) => Promise<void> | void;
  pendingSlotLocate: { slot: SlotId; token: number } | null | undefined;
  loadCloudTracks: (tracks: Track[]) => void;
  mergeCloudTracks: (added: Track[], removedIds: string[], updated: Track[]) => void;
  handleLibraryScrollPositionChange: (pos: number) => void;
  handleSlotContentReady: (slot: SlotId) => void;
  handleSlotLocatePrepared: (token: number) => void;
  handleCategoryChange: (selection: string | null) => void;
  libraryContentRef: React.RefObject<HTMLDivElement>;
  setActiveTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  onClearOrphanCache: () => Promise<{ metadataDeleted: number; coversDeleted: number; errors: string[] }>;
  onOpenPlaylist: (
    source: OnlineSource,
    playlistId: string,
    playlistTitle: string,
    totalTrackCount: number,
  ) => Promise<void>;
  audioElement: ReactElement | null;
  isLinux: boolean;
  // Playlist browse/play decoupling: the playlist being browsed in the
  // Library list (viewSlot === 'playlist') is shown from this preview rather
  // than the 'playlist' play slot, so opening a playlist never interrupts
  // playback. The slot is only committed when the user clicks a row.
  libraryBrowsingTracks: Track[];
  onPlayLibraryPlaylistTrack: (index: number) => void;
}

const AppShell: React.FC<AppShellProps> = ({
  ui,
  sidebar,
  library,
  player,
  importVm,
  online,
  playerController,
  slots,
  activeTracks,
  viewSlot,
  handleSwitchSlot,
  pendingSlotLocate,
  loadCloudTracks,
  mergeCloudTracks,
  handleLibraryScrollPositionChange,
  handleSlotContentReady,
  handleSlotLocatePrepared,
  handleCategoryChange,
  libraryContentRef,
  setActiveTracks,
  onClearOrphanCache,
  onOpenPlaylist,
  audioElement,
  isLinux,
  libraryBrowsingTracks,
  onPlayLibraryPlaylistTrack,
}) => {
  const { t } = useTranslation();
  const {
    viewMode,
    transitionToView,
    pageContentRef,
    isFocusMode,
    setIsFocusMode,
    autoLocateToken,
    pendingNavigation,
    setPendingNavigation,
    headerHeight,
    metadataViewRef,
    isWindowFocused,
    floatingPanel,
    glassUI,
    handleNavigate,
  } = ui;

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(current => !current);
  }, [setIsFocusMode]);
  const openSettings = useCallback(() => {
    transitionToView(ViewMode.SETTINGS);
  }, [transitionToView]);
  const closeOverlayView = useCallback(() => {
    transitionToView(ViewMode.PLAYER);
  }, [transitionToView]);
  const hasUnavailableTracks = useMemo(
    () => activeTracks.some(track => track.available === false),
    [activeTracks],
  );
  const libraryTrackCounts = useMemo(() => ({
    local: slots.local.tracks.length,
    cloud: slots.cloud.tracks.length,
    online: slots.online.tracks.length,
  }), [slots.local.tracks.length, slots.cloud.tracks.length, slots.online.tracks.length]);
  const searchBox = useMemo(() => (
    <SearchBox
      isWindowFocused={isWindowFocused}
      localTracks={slots.local.tracks}
      cloudTracks={slots.cloud.tracks}
      onNavigateToTrack={online.navigateToTrack}
      onOnlineDownload={online.download}
      onOnlineStreamPlay={online.playSong}
      onOnlineUpload={online.upload}
      onlineProgress={online.progress}
    />
  ), [
    isWindowFocused,
    online.download,
    online.navigateToTrack,
    online.playSong,
    online.progress,
    online.upload,
    slots.cloud.tracks,
    slots.local.tracks,
  ]);

  return (
    <>
      {audioElement}
      <div className={`flex h-screen w-screen overflow-hidden font-sans relative${isLinux ? ' rounded-lg' : ''}`} style={floatingPanel ? {
        background: 'linear-gradient(135deg, var(--theme-background-gradient-start, #101922), var(--theme-background-gradient-end, #1a2533))',
      } : {
        backgroundColor: 'transparent',
      }}>
        <TitleBar
          isFocusMode={isFocusMode}
          onToggleFocusMode={toggleFocusMode}
        />
        <SidebarToggleButton
          onToggle={sidebar.toggleCollapsed}
          collapsed={sidebar.collapsed}
          isFocusMode={isFocusMode}
        />
        <div className="flex flex-1">
          <Sidebar
          onNavigate={handleNavigate}
          onReloadFiles={importVm.reloadFiles}
          hasUnavailableTracks={hasUnavailableTracks}
          currentView={viewMode}
          viewMode={viewMode}
          activeSlotId={viewSlot}
          onSlotChange={handleSwitchSlot}
          libraryTrackCounts={libraryTrackCounts}
          onOpenPlaylist={onOpenPlaylist}
          floating={floatingPanel}
          width={sidebar.width}
          collapsed={sidebar.collapsed}
          isResizing={sidebar.isResizing}
          onResizeStart={sidebar.startResize}
        />
        <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden pt-8"
          style={floatingPanel ? {} : {
            background: 'linear-gradient(135deg, var(--theme-background-gradient-start, #101922), var(--theme-background-gradient-end, #1a2533))',
          }}
        >
          {/* Frosted header band — clipped to each view's measured header bottom.
              For LibraryView this ends at the song-list column divider; for
              Settings/Theme it ends at their header container bottom. */}
          {glassUI && (viewMode === ViewMode.PLAYER || viewMode === ViewMode.SETTINGS || viewMode === ViewMode.THEME) && headerHeight > 0 && (
            <div
              className="frosted-header absolute top-0 left-0 right-0 z-20"
              style={{ height: 40 + headerHeight }}
            />
          )}
          <input
            type="file"
            ref={importVm.fileInputRef}
            multiple
            accept=".flac,.mp3"
            className="hidden"
            onChange={importVm.onFileInputChange}
          />
          <div ref={pageContentRef} className={`flex-1 overflow-hidden ${floatingPanel ? 'px-10 pt-2 pb-2' : 'px-10 pt-2 pb-2'}`}>
            {viewMode === ViewMode.BROWSE ? (
              <BrowseView
                online={online}
                onNavigateToSettings={openSettings}
              />
            ) : viewMode === ViewMode.METADATA ? (
              <MetadataView
                ref={metadataViewRef}
                libraryTracks={activeTracks}
                onImportFromLibrary={(trackIds) => {
                  logger.debug('[App] Imported tracks to metadata view:', trackIds);
                }}
                onUpdateTrack={(updatedTrack) => {
                  setActiveTracks(prev => prev.map(track =>
                    track.id === updatedTrack.id ? updatedTrack : track
                  ));
                }}
              />
            ) : (
              <div ref={libraryContentRef} className="h-full">
              <LibraryView
                tracks={viewSlot === 'playlist' && libraryBrowsingTracks.length > 0
                  ? libraryBrowsingTracks
                  : library.slots[library.viewSlot].tracks}
                currentTrackIndex={library.slots[library.viewSlot].currentTrackIndex}
                {...(player.currentTrack?.id != null && { currentTrackId: player.currentTrack.id })}
                onTrackSelect={viewSlot === 'playlist' && libraryBrowsingTracks.length > 0
                  ? onPlayLibraryPlaylistTrack
                  : library.selectTrack}
                onRemoveTrack={library.removeTrack}
                onRemoveMultipleTracks={library.removeTracks}
                onImportClick={importVm.importClick}
                importDisabled={importVm.importDisabled}
                importDisabledReason={
                  library.viewSlot === 'cloud' ? library.cloudImportDisabledReason : undefined
                }
                onOpenSettings={openSettings}
                onDropFiles={importVm.dropFiles}
                onDropFilePaths={importVm.dropFilePaths}
                onReorderTracks={library.reorder}
                onUpdateTrack={library.updateTrack}
                isFocusMode={isFocusMode}
                savedScrollPosition={library.slots[library.viewSlot].scrollPosition}
                onScrollPositionChange={handleLibraryScrollPositionChange}
                autoLocateToken={autoLocateToken}
                importProgress={importVm.importProgress}
                dataSource={library.viewSlot}
                activeSlotId={library.activeSlotId}
                onSwitchSlot={library.switchViewSlot}
                pendingLocateSlot={pendingSlotLocate?.slot}
                pendingLocateToken={pendingSlotLocate?.token}
                onPendingLocatePrepared={handleSlotLocatePrepared}
                onSlotContentReady={handleSlotContentReady}
                filterType={slots[viewSlot].filterType}
                categorySelection={slots[viewSlot].categorySelection}
                onCategoryChange={handleCategoryChange}
                onHeaderHeightChange={ui.setHeaderHeight}
                onLoadCloudTracks={loadCloudTracks}
                onMergeCloudTracks={mergeCloudTracks}
                {...(viewSlot === 'playlist' ? { onLoadMorePlaylist: playerController.loadMorePlaylistInLibrary } : {})}
                playlistLoading={viewSlot === 'playlist' ? playerController.libraryPlaylistLoadState.isLoading : false}
                playlistHasMore={viewSlot === 'playlist' ? playerController.libraryPlaylistLoadState.hasMore : false}
                playlistLoadError={viewSlot === 'playlist' ? playerController.libraryPlaylistLoadState.error : null}
                {...(viewSlot === 'playlist' && playerController.libraryPlaylistLoadState.title
                  ? { playlistTitle: playerController.libraryPlaylistLoadState.title }
                  : {})}
                {...(viewSlot === 'playlist' && playerController.libraryPlaylistLoadState.totalTrackCount != null
                  ? { playlistTrackCount: playerController.libraryPlaylistLoadState.totalTrackCount }
                  : {})}
                searchBox={searchBox}
              />
              </div>
            )}
          </div>
          {viewMode === ViewMode.SETTINGS && (
            <FloatingPanel
              onClose={closeOverlayView}
              className="floating-panel-shell--settings"
            >
              <SettingsPanel
                onClose={closeOverlayView}
                onClearOrphanCache={onClearOrphanCache}
              />
            </FloatingPanel>
          )}
          {viewMode === ViewMode.THEME && (
            <FloatingPanel
              onClose={closeOverlayView}
              className="floating-panel-shell--theme"
            >
              <ThemePanel onClose={closeOverlayView} />
            </FloatingPanel>
          )}
          <Controls
            track={player.currentTrack}
            isPlaying={player.isPlaying}
            currentTime={player.currentTime}
            volume={player.volume}
            onTogglePlay={player.togglePlay}
            onSkipNext={player.next}
            onSkipPrev={player.previous}
            onSeek={player.seek}
            onVolumeChange={player.changeVolume}
            onToggleMute={player.toggleMute}
            playbackMode={player.playbackMode}
            onTogglePlaybackMode={player.togglePlaybackMode}
            onToggleFocus={toggleFocusMode}
            isFocusMode={isFocusMode}
            forceUpdateCounter={0}
            audioRef={player.audioRef}
            floating={floatingPanel}
          />
        </main>
        <FocusMode
          track={player.currentTrack}
          isVisible={isFocusMode}
          currentTime={player.currentTime}
          isPlaying={player.isPlaying}
          onTogglePlay={player.togglePlay}
          onSkipNext={player.next}
          onSkipPrev={player.previous}
          onSeek={player.seek}
          volume={player.volume}
          onVolumeChange={player.changeVolume}
          onToggleMute={player.toggleMute}
          playbackMode={player.playbackMode}
          onTogglePlaybackMode={player.togglePlaybackMode}
          onToggleFocus={toggleFocusMode}
          audioRef={player.audioRef}
        />
        </div>
      </div>
      <GsapModal
        isOpen={pendingNavigation !== null}
        overlayClassName="z-50"
        overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
        panelClassName="rounded-2xl p-6 w-96 shadow-2xl"
        panelStyle={{ backgroundColor: 'var(--theme-background-dark, #0d1520)', border: '1px solid var(--theme-border-light, rgba(255,255,255,0.15))' }}
      >
        {pendingNavigation && (
          <>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--theme-text-primary, #fff)' }}>
              {t('metadataView.unsavedTitle')}
            </h3>
            <p className="mb-6 text-sm" style={{ color: 'var(--theme-text-secondary, rgba(255,255,255,0.6))' }}>
              {t('metadataView.unsavedMessage')}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingNavigation(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ color: 'var(--theme-text-secondary, rgba(255,255,255,0.6))' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--theme-background-card-hover, rgba(255,255,255,0.1))'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  metadataViewRef.current?.stashAll();
                  transitionToView(pendingNavigation);
                  setIsFocusMode(false);
                  setPendingNavigation(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: 'var(--theme-background-card-hover, rgba(255,255,255,0.1))', color: 'var(--theme-text-primary, #fff)' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--theme-border-light, rgba(255,255,255,0.2))'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--theme-background-card-hover, rgba(255,255,255,0.1))'; }}
              >
                {t('metadataView.stash')}
              </button>
              <button
                onClick={async () => {
                  await metadataViewRef.current?.saveAll();
                  transitionToView(pendingNavigation);
                  setIsFocusMode(false);
                  setPendingNavigation(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: 'var(--theme-primary, #2b8cee)', color: '#fff' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--theme-primary-hover, #1a7de0)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--theme-primary, #2b8cee)'; }}
              >
                {t('metadataView.saveChanges')}
              </button>
            </div>
          </>
        )}
      </GsapModal>
    </>
  );
};

export default AppShell;
