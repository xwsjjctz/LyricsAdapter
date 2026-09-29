import React, { type ReactElement, useCallback, useMemo, useState } from 'react';
import { LibrarySlot, SlotId, Track, ViewMode } from '../types';
import type { OnlineSource, PlaylistInfo } from '../services/onlineMusicProvider';
import TitleBar from './TitleBar';
import Controls from './Controls';
import FocusMode from './FocusMode';
import LibraryWallView from './LibraryWallView';
import LibraryView from './LibraryView';
import DownloadStatusPill from './wall/DownloadStatusPill';
import SearchWallView from './search/SearchWallView';
import SettingsView from './settings/SettingsView';
import CommandPalette from './palette/CommandPalette';
import type { PaletteLibrarySources } from './palette/usePaletteItems';
import { useAppCommands, type AppCommandHandlers } from '../commands/useAppCommands';
import type { PaletteSourceSlot } from '../commands/buildAppCommands';
import { commandPalette } from '../hooks/useCommandPalette';
import { useLibraryCloudSync } from '../hooks/useLibraryCloudSync';
import { webdavClient } from '../services/webdavClient';
import { notify } from '../services/notificationService';
import { useTranslation } from 'react-i18next';
import type { useUIStore } from '../stores/uiStore';
import type { useLibraryViewModel } from '../viewmodels/useLibraryViewModel';
import type { usePlayerViewModel } from '../viewmodels/usePlayerViewModel';
import type { useImportViewModel } from '../viewmodels/useImportViewModel';
import type { useOnlineViewModel } from '../viewmodels/useOnlineViewModel';
import type { usePlayerController } from '../controllers/usePlayerController';

// The single application shell. AppContent owns wiring while this component
// remains presentational; all state and user intents arrive via props.
//
// Layout: the poster wall (library or search results) always fills the
// window. Settings float over it as a glass sheet, the control bar floats at
// the bottom, and every other entry point lives in the Cmd+K palette.

interface AppShellProps {
  ui: ReturnType<typeof useUIStore>;
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
  handleSlotLocatePrepared: (token: number) => void;
  // The classic list view reports its own entrance, scroll offset and category.
  handleSlotContentReady: (slot: SlotId) => void;
  handleLibraryScrollPositionChange: (position: number) => void;
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
  // Playlist browse/play decoupling: the playlist being browsed on the wall
  // (viewSlot === 'playlist') is shown from this preview rather than the
  // 'playlist' play slot, so opening a playlist never interrupts playback.
  // The slot is only committed when the user plays a poster.
  libraryBrowsingTracks: Track[];
  onPlayLibraryPlaylistTrack: (index: number) => void;
}

const AppShell: React.FC<AppShellProps> = ({
  ui,
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
  handleSlotLocatePrepared,
  handleSlotContentReady,
  handleLibraryScrollPositionChange,
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
    pageContentRef,
    isFocusMode,
    setIsFocusMode,
    floatingPanel,
    handleNavigate,
    settingsSection,
    openSettings,
    closeSettings,
    libraryLayout,
    setLibraryLayout,
    autoLocateToken,
    locateRequest,
    requestLocate,
    handleLocateRequestHandled,
  } = ui;

  const [searchQuery, setSearchQuery] = useState('');
  const openSearchResults = useCallback((query: string) => {
    setSearchQuery(query);
    handleNavigate(ViewMode.SEARCH);
  }, [handleNavigate]);
  const isSearchView = viewMode === ViewMode.SEARCH;
  const openWall = useCallback(() => handleNavigate(ViewMode.WALL), [handleNavigate]);
  const editSearchQuery = useCallback(() => {
    commandPalette.open('library');
    commandPalette.setQuery(searchQuery);
  }, [searchQuery]);

  // A browsed playlist always shows its own (possibly still loading) tracks,
  // never the previously played playlist held in the 'playlist' play slot.
  const playlistState = playerController.libraryPlaylistLoadState;
  const isBrowsingPlaylist = viewSlot === 'playlist' && !!playlistState.playlistId;
  const shownTracks = isBrowsingPlaylist ? libraryBrowsingTracks : library.slots[library.viewSlot].tracks;
  const playShownTrack = viewSlot === 'playlist' && libraryBrowsingTracks.length > 0
    ? onPlayLibraryPlaylistTrack
    : library.selectTrack;
  // Identity of the shown list; a change plays the wall's source-switch animation.
  const librarySourceKey = viewSlot === 'playlist' && playlistState.playlistId
    ? `playlist:${playlistState.source}:${playlistState.playlistId}`
    : viewSlot;

  // Cloud tracks load (and refresh) regardless of which view is on screen.
  const { loadProgress: cloudLoadProgress, refreshCloudTracks } = useLibraryCloudSync({
    dataSource: viewSlot,
    onLoadCloudTracks: loadCloudTracks,
    onMergeCloudTracks: mergeCloudTracks,
  });
  const refreshCloud = useCallback(() => {
    void refreshCloudTracks().catch(() => notify(t('settingsDialog.webdavTitle'), t('browse.error')));
  }, [refreshCloudTracks, t]);

  const [selectionRequest, setSelectionRequest] = useState(0);
  const selectTracks = useCallback(() => {
    if (isSearchView) handleNavigate(ViewMode.WALL);
    setSelectionRequest(token => token + 1);
  }, [handleNavigate, isSearchView]);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(current => !current);
  }, [setIsFocusMode]);

  const switchSource = useCallback((slot: PaletteSourceSlot) => {
    if (slot === 'cloud' && !webdavClient.hasConfig()) {
      notify(t('settingsDialog.webdavTitle'), t('settingsDialog.webdavFillAll'));
      openSettings('cloud');
      return;
    }
    handleNavigate(ViewMode.WALL);
    void handleSwitchSlot(slot);
  }, [handleNavigate, handleSwitchSlot, openSettings, t]);
  const openPlaylistInfo = useCallback((playlist: PlaylistInfo) => {
    handleNavigate(ViewMode.WALL);
    void onOpenPlaylist(playlist.source, playlist.id, playlist.name, playlist.songCount)
      .catch(() => notify(t('playlists.title'), t('browse.error')));
  }, [handleNavigate, onOpenPlaylist, t]);

  // Scroll the wall to the playing track, switching back from search results
  // or over to the source it plays from when the shown list lacks it.
  const currentTrackId = player.currentTrack?.id;
  const { activeSlotId, switchViewSlot } = library;
  const locateCurrentTrack = useCallback(() => {
    if (!currentTrackId) return;
    if (viewMode !== ViewMode.WALL) handleNavigate(ViewMode.WALL);
    if (shownTracks.some(track => track.id === currentTrackId)) requestLocate();
    else if (activeSlotId !== viewSlot) void switchViewSlot(activeSlotId, { locateCurrentTrack: true });
  }, [activeSlotId, currentTrackId, handleNavigate, requestLocate, shownTracks, switchViewSlot, viewMode, viewSlot]);

  // Switching layout shows the library page right away, even from search results.
  const switchLibraryLayout = useCallback((layout: 'wall' | 'list') => {
    setLibraryLayout(layout);
    if (viewMode !== ViewMode.WALL) handleNavigate(ViewMode.WALL);
  }, [handleNavigate, setLibraryLayout, viewMode]);

  const playAll = useCallback(() => playShownTrack(0), [playShownTrack]);
  const shuffleAll = useCallback(() => {
    player.setPlaybackMode('shuffle');
    playShownTrack(Math.floor(Math.random() * shownTracks.length));
  }, [playShownTrack, player, shownTracks.length]);

  const canManageShown = viewSlot === 'local' || viewSlot === 'online';
  const hasUnavailableTracks = useMemo(
    () => activeTracks.some(track => track.available === false),
    [activeTracks],
  );
  const commandHandlers = useMemo<AppCommandHandlers>(() => ({
    trackCounts: { local: slots.local.tracks.length, cloud: slots.cloud.tracks.length, online: slots.online.tracks.length },
    switchSource,
    openPlaylist: openPlaylistInfo,
    importFiles: importVm.importClick,
    importDisabled: importVm.importDisabled,
    reloadFiles: importVm.reloadFiles,
    hasUnavailableTracks,
    selectTracks: canManageShown && shownTracks.length > 0 ? selectTracks : undefined,
    refreshCloud: viewSlot === 'cloud' && webdavClient.hasConfig() ? refreshCloud : undefined,
    playAll: shownTracks.length > 0 ? playAll : undefined,
    shuffleAll: shownTracks.length > 0 ? shuffleAll : undefined,
    locateCurrentTrack: currentTrackId ? locateCurrentTrack : undefined,
    toggleFocusMode,
    togglePlaybackMode: player.togglePlaybackMode,
    toggleMute: player.toggleMute,
    openSettings,
    openWall,
    libraryLayout,
    setLibraryLayout: switchLibraryLayout,
  }), [
    canManageShown, currentTrackId, hasUnavailableTracks, locateCurrentTrack, importVm.importClick, importVm.importDisabled, importVm.reloadFiles,
    libraryLayout, openPlaylistInfo, openSettings, openWall, switchLibraryLayout, playShownTrack, player, refreshCloud, selectTracks,
    shownTracks.length, slots.cloud.tracks.length, slots.local.tracks.length, slots.online.tracks.length,
    switchSource, toggleFocusMode, viewSlot,
  ]);
  const { commands, visiblePlaylists } = useAppCommands(commandHandlers);
  const paletteLibrary = useMemo<PaletteLibrarySources>(() => ({
    localTracks: slots.local.tracks,
    cloudTracks: slots.cloud.tracks,
    playlists: visiblePlaylists,
    playTrack: online.navigateToTrack,
    playOnlineSong: online.playSong,
    openPlaylist: openPlaylistInfo,
    openAllResults: openSearchResults,
  }), [online.navigateToTrack, online.playSong, openPlaylistInfo, openSearchResults, slots.cloud.tracks, slots.local.tracks, visiblePlaylists]);

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
        <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden"
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
          <div ref={pageContentRef} className="flex-1 overflow-hidden">
            {isSearchView ? (
              <SearchWallView
                query={searchQuery}
                localTracks={slots.local.tracks}
                cloudTracks={slots.cloud.tracks}
                currentTrackId={player.currentTrack?.id}
                onNavigateToTrack={online.navigateToTrack}
                onOnlineStreamPlay={online.playSong}
                onDownloadTrack={online.downloadTrack}
                onEditQuery={editSearchQuery}
                onClose={openWall}
              />
            ) : (
              <div ref={libraryContentRef} className="h-full">
                {libraryLayout === 'list' ? (
                  <div className="h-full px-10 pt-10 pb-2">
                    <LibraryView
                      tracks={shownTracks}
                      currentTrackIndex={slots[viewSlot].currentTrackIndex}
                      {...(player.currentTrack?.id != null && { currentTrackId: player.currentTrack.id })}
                      onTrackSelect={playShownTrack}
                      onRemoveTrack={library.removeTrack}
                      onRemoveMultipleTracks={library.removeTracks}
                      onImportClick={importVm.importClick}
                      importDisabled={importVm.importDisabled}
                      onOpenSettings={() => openSettings('cloud')}
                      onDropFiles={importVm.dropFiles}
                      onDropFilePaths={importVm.dropFilePaths}
                      onReorderTracks={library.reorder}
                      onUpdateTrack={library.updateTrack}
                      onDownloadTrack={online.downloadTrack}
                      isFocusMode={isFocusMode}
                      savedScrollPosition={slots[viewSlot].scrollPosition}
                      onScrollPositionChange={handleLibraryScrollPositionChange}
                      autoLocateToken={autoLocateToken}
                      locateRequest={locateRequest}
                      onLocateRequestHandled={handleLocateRequestHandled}
                      importProgress={importVm.importProgress}
                      dataSource={viewSlot}
                      activeSlotId={library.activeSlotId}
                      onSwitchSlot={library.switchViewSlot}
                      pendingLocateSlot={pendingSlotLocate?.slot}
                      pendingLocateToken={pendingSlotLocate?.token}
                      onPendingLocatePrepared={handleSlotLocatePrepared}
                      onSlotContentReady={handleSlotContentReady}
                      filterType={slots[viewSlot].filterType}
                      categorySelection={slots[viewSlot].categorySelection}
                      onCategoryChange={handleCategoryChange}
                      cloudLoadProgress={cloudLoadProgress}
                      onRefreshCloud={refreshCloudTracks}
                      {...(viewSlot === 'playlist' ? { onLoadMorePlaylist: playerController.loadMorePlaylistInLibrary } : {})}
                      playlistLoading={viewSlot === 'playlist' && playlistState.isLoading}
                      playlistHasMore={viewSlot === 'playlist' && playlistState.hasMore}
                      playlistLoadError={viewSlot === 'playlist' ? playlistState.error : null}
                      {...(viewSlot === 'playlist' && playlistState.title ? { playlistTitle: playlistState.title } : {})}
                      {...(viewSlot === 'playlist' && playlistState.totalTrackCount != null
                        ? { playlistTrackCount: playlistState.totalTrackCount }
                        : {})}
                      {...(isBrowsingPlaylist && shownTracks.length > 0 ? { onPlayAll: playAll, onShuffleAll: shuffleAll } : {})}
                    />
                  </div>
                ) : (
                    <LibraryWallView
                      tracks={shownTracks}
                      sourceKey={librarySourceKey}
                      dataSource={library.viewSlot}
                      currentTrackId={player.currentTrack?.id}
                      onTrackSelect={playShownTrack}
                      onRemoveTrack={library.removeTrack}
                      onRemoveMultipleTracks={library.removeTracks}
                      onUpdateTrack={library.updateTrack}
                      onDownloadTrack={online.downloadTrack}
                      onSwapTracks={library.swap}
                      playlistLoading={viewSlot === 'playlist' && playlistState.isLoading}
                      playlistHasMore={viewSlot === 'playlist' && playlistState.hasMore}
                      playlistLoadError={viewSlot === 'playlist' ? playlistState.error : null}
                      onLoadMorePlaylist={viewSlot === 'playlist' ? playerController.loadMorePlaylistInLibrary : undefined}
                      pendingLocateSlot={pendingSlotLocate?.slot}
                      pendingLocateToken={pendingSlotLocate?.token}
                      onPendingLocatePrepared={handleSlotLocatePrepared}
                      autoLocateToken={autoLocateToken}
                      locateRequest={locateRequest}
                      onLocateRequestHandled={handleLocateRequestHandled}
                      importDisabled={importVm.importDisabled}
                      onImportClick={importVm.importClick}
                      onDropFiles={importVm.dropFiles}
                      onDropFilePaths={importVm.dropFilePaths}
                      importProgress={importVm.importProgress}
                      loadProgress={cloudLoadProgress}
                      selectionRequest={selectionRequest}
                    />
                )}
              </div>
            )}
          </div>
          <DownloadStatusPill progress={online.progress} />
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
        {settingsSection && <SettingsView initialSection={settingsSection} onClose={closeSettings} />}
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
      <CommandPalette commands={commands} library={paletteLibrary} />
    </>
  );
};

export default AppShell;
