import React, { type ReactElement, useCallback, useMemo, useState } from 'react';
import { LibrarySlot, SlotId, Track, ViewMode } from '../types';
import { MACOS_PLAYER_BOTTOM_INSET } from './playerLayout';
import type { OnlineSource } from '../services/onlineMusicProvider';
import TitleBar from './TitleBar';
import SidebarToggleButton from './SidebarToggleButton';
import Sidebar from './Sidebar';
import LibraryView from './LibraryView';
import SearchView from './search/SearchView';
import UpNextPanel from './UpNextPanel';
import Controls from './Controls';
import FocusMode from './FocusMode';
import SearchBox from './SearchBox';
import SettingsView from './settings/SettingsView';
import { useTranslation } from 'react-i18next';
import type { useUIStore } from '../stores/uiStore';
import type { useSidebarLayout } from '../hooks/useSidebarLayout';
import type { useLibraryViewModel } from '../viewmodels/useLibraryViewModel';
import type { usePlayerViewModel } from '../viewmodels/usePlayerViewModel';
import type { useImportViewModel } from '../viewmodels/useImportViewModel';
import type { useOnlineViewModel } from '../viewmodels/useOnlineViewModel';
import type { usePlayerController } from '../controllers/usePlayerController';

// The single application shell. AppContent owns wiring while this component
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
    isWindowFocused,
    floatingPanel,
    handleNavigate,
  } = ui;

  const [searchQuery, setSearchQuery] = useState('');
  const openSearchResults = useCallback((query: string) => {
    setSearchQuery(query);
    handleNavigate(ViewMode.SEARCH);
  }, [handleNavigate]);
  const isSearchView = viewMode === ViewMode.SEARCH;
  // A browsed playlist always shows its own (possibly still loading) tracks,
  // never the previously played playlist held in the 'playlist' play slot.
  const isBrowsingPlaylist = viewSlot === 'playlist' && !!playerController.libraryPlaylistLoadState.playlistId;
  const playPlaylistFromStart = useCallback(() => {
    if (libraryBrowsingTracks.length > 0) onPlayLibraryPlaylistTrack(0);
  }, [libraryBrowsingTracks.length, onPlayLibraryPlaylistTrack]);
  const shufflePlaylist = useCallback(() => {
    if (libraryBrowsingTracks.length === 0) return;
    player.setPlaybackMode('shuffle');
    onPlayLibraryPlaylistTrack(Math.floor(Math.random() * libraryBrowsingTracks.length));
  }, [libraryBrowsingTracks.length, onPlayLibraryPlaylistTrack, player]);
  const [isUpNextOpen, setIsUpNextOpen] = useState(false);
  const toggleUpNext = useCallback(() => setIsUpNextOpen(open => !open), []);
  const closeUpNext = useCallback(() => setIsUpNextOpen(false), []);
  const playUpNextIndex = useCallback((index: number) => {
    playerController.handleTrackSelect(index, library.activeSlotId);
  }, [library.activeSlotId, playerController]);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(current => !current);
  }, [setIsFocusMode]);
  const openSettings = useCallback(() => {
    transitionToView(ViewMode.SETTINGS);
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
      initialQuery={isSearchView ? searchQuery : ''}
      onNavigateToTrack={online.navigateToTrack}
      onOnlineStreamPlay={online.playSong}
      onDownloadTrack={online.downloadTrack}
      onlineProgress={online.progress}
      onOpenResults={openSearchResults}
    />
  ), [
    isSearchView,
    isWindowFocused,
    online.downloadTrack,
    online.navigateToTrack,
    online.playSong,
    online.progress,
    openSearchResults,
    searchQuery,
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
          upNextOpen={isUpNextOpen}
          onToggleUpNext={toggleUpNext}
        />
        <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden pt-8"
          style={floatingPanel ? {} : {
            background: 'linear-gradient(135deg, var(--theme-background-gradient-start, #101922), var(--theme-background-gradient-end, #1a2533))',
          }}
        >
          <input
            type="file"
            ref={importVm.fileInputRef}
            multiple
            accept=".flac,.mp3"
            className="hidden"
            onChange={importVm.onFileInputChange}
          />
          <div ref={pageContentRef} className="flex-1 overflow-hidden px-10 pt-2 pb-2">
            {viewMode === ViewMode.SETTINGS ? (
              <SettingsView bottomInset={MACOS_PLAYER_BOTTOM_INSET} />
            ) : isSearchView ? (
              <SearchView
                query={searchQuery}
                localTracks={slots.local.tracks}
                cloudTracks={slots.cloud.tracks}
                currentTrackId={player.currentTrack?.id}
                searchBox={searchBox}
                onNavigateToTrack={online.navigateToTrack}
                onOnlineStreamPlay={online.playSong}
                onDownloadTrack={online.downloadTrack}
                onlineProgress={online.progress}
              />
            ) : (
              <div ref={libraryContentRef} className="h-full">
              <LibraryView
                tracks={isBrowsingPlaylist ? libraryBrowsingTracks : library.slots[library.viewSlot].tracks}
                currentTrackIndex={library.slots[library.viewSlot].currentTrackIndex}
                {...(player.currentTrack?.id != null && { currentTrackId: player.currentTrack.id })}
                onTrackSelect={viewSlot === 'playlist' && libraryBrowsingTracks.length > 0
                  ? onPlayLibraryPlaylistTrack
                  : library.selectTrack}
                onRemoveTrack={library.removeTrack}
                onRemoveMultipleTracks={library.removeTracks}
                onImportClick={importVm.importClick}
                importDisabled={importVm.importDisabled}
                onOpenSettings={openSettings}
                onDropFiles={importVm.dropFiles}
                onDropFilePaths={importVm.dropFilePaths}
                onReorderTracks={library.reorder}
                onUpdateTrack={library.updateTrack}
                onDownloadTrack={online.downloadTrack}
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
                {...(isBrowsingPlaylist ? { onPlayAll: playPlaylistFromStart, onShuffleAll: shufflePlaylist } : {})}
              />
              </div>
            )}
          </div>
          {isUpNextOpen && !isFocusMode && (
            <UpNextPanel
              tracks={activeTracks}
              currentIndex={library.slots[library.activeSlotId].currentTrackIndex}
              mode={player.playbackMode}
              sourceLabel={t(library.activeSlotId === 'playlist' ? 'sidebar.playlists' : `sidebar.${library.activeSlotId}`)}
              bottomInset={MACOS_PLAYER_BOTTOM_INSET}
              onPlayIndex={playUpNextIndex}
              onClose={closeUpNext}
            />
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
          getCurrentPlaybackTime={player.getCurrentPlaybackTime}
        />
        </div>
      </div>
    </>
  );
};

export default AppShell;
