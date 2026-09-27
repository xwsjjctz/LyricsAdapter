import React, { type ReactElement, useCallback, useMemo, useState } from 'react';
import { LibrarySlot, SlotId, Track, ViewMode } from '../types';
import { MACOS_PLAYER_BOTTOM_INSET } from './playerLayout';
import type { OnlineSource } from '../services/onlineMusicProvider';
import TitleBar from './TitleBar';
import SidebarToggleButton from './SidebarToggleButton';
import Sidebar from './Sidebar';
import LibraryView from './LibraryView';
import SearchView from './search/SearchView';
import Controls from './Controls';
import FocusMode from './FocusMode';
import SearchBox from './SearchBox';
import LibraryWallView from './LibraryWallView';
import type { LibrarySource } from './LibrarySourceMenu';
import WallChrome from './wall/WallChrome';
import type { PlaylistInfo } from '../services/onlineMusicProvider';
import SettingsView, { type SettingsSectionId } from './settings/SettingsView';
import CommandPalette from './palette/CommandPalette';
import type { PaletteLibrarySources } from './palette/usePaletteItems';
import { useAppCommands, type AppCommandHandlers } from '../commands/useAppCommands';
import type { PaletteSourceSlot } from '../commands/buildAppCommands';
import { webdavClient } from '../services/webdavClient';
import { notify } from '../services/notificationService';
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
  const isWall = viewMode === ViewMode.WALL;
  const playlistState = playerController.libraryPlaylistLoadState;
  const librarySource = useMemo<LibrarySource | null>(() => {
    if (viewSlot === 'local' || viewSlot === 'online') return { kind: 'slot', slot: viewSlot };
    if (viewSlot === 'playlist' && playlistState.playlistId) {
      return { kind: 'playlist', source: playlistState.source, id: playlistState.playlistId };
    }
    return null;
  }, [playlistState.playlistId, playlistState.source, viewSlot]);
  const librarySourceKey = librarySource?.kind === 'playlist'
    ? `playlist:${librarySource.source}:${librarySource.id}`
    : viewSlot;
  const librarySourceTitle = viewSlot === 'playlist'
    ? (playlistState.title ?? t('sidebar.playlists'))
    : t(`sidebar.${viewSlot}`);
  const selectLibrarySlot = useCallback((slot: 'local' | 'online') => {
    void library.switchViewSlot(slot);
  }, [library]);
  const openLibraryPlaylist = useCallback((playlist: PlaylistInfo) => {
    void onOpenPlaylist(playlist.source, playlist.id, playlist.name, playlist.songCount);
  }, [onOpenPlaylist]);
  const leaveWall = useCallback(() => handleNavigate(ViewMode.PLAYER), [handleNavigate]);
  const wallChrome = (
    <WallChrome
      current={librarySource}
      title={librarySourceTitle}
      counts={{ local: slots.local.tracks.length, online: slots.online.tracks.length }}
      onBack={leaveWall}
      onSelectSlot={selectLibrarySlot}
      onOpenPlaylist={openLibraryPlaylist}
    />
  );
  const playPlaylistFromStart = useCallback(() => {
    if (libraryBrowsingTracks.length > 0) onPlayLibraryPlaylistTrack(0);
  }, [libraryBrowsingTracks.length, onPlayLibraryPlaylistTrack]);
  const shufflePlaylist = useCallback(() => {
    if (libraryBrowsingTracks.length === 0) return;
    player.setPlaybackMode('shuffle');
    onPlayLibraryPlaylistTrack(Math.floor(Math.random() * libraryBrowsingTracks.length));
  }, [libraryBrowsingTracks.length, onPlayLibraryPlaylistTrack, player]);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(current => !current);
  }, [setIsFocusMode]);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general');
  const openSettings = useCallback(() => {
    setSettingsSection('general');
    transitionToView(ViewMode.SETTINGS);
  }, [transitionToView]);
  const openSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section);
    handleNavigate(ViewMode.SETTINGS);
  }, [handleNavigate]);

  // The command palette drives the library the same way the old chrome did.
  const isLibraryPage = viewMode === ViewMode.WALL || viewMode === ViewMode.PLAYER;
  const shownTracks = isBrowsingPlaylist ? libraryBrowsingTracks : library.slots[library.viewSlot].tracks;
  const playShownTrack = viewSlot === 'playlist' && libraryBrowsingTracks.length > 0
    ? onPlayLibraryPlaylistTrack
    : library.selectTrack;
  const openWall = useCallback(() => handleNavigate(ViewMode.WALL), [handleNavigate]);
  const switchSource = useCallback((slot: PaletteSourceSlot) => {
    if (slot === 'cloud' && !webdavClient.hasConfig()) {
      notify(t('settingsDialog.webdavTitle'), t('settingsDialog.webdavFillAll'));
      openSettingsSection('cloud');
      return;
    }
    if (!isLibraryPage) handleNavigate(ViewMode.WALL);
    void handleSwitchSlot(slot);
  }, [handleNavigate, handleSwitchSlot, isLibraryPage, openSettingsSection, t]);
  const openPlaylistInfo = useCallback((playlist: PlaylistInfo) => {
    if (!isLibraryPage) handleNavigate(ViewMode.WALL);
    void onOpenPlaylist(playlist.source, playlist.id, playlist.name, playlist.songCount)
      .catch(() => notify(t('playlists.title'), t('browse.error')));
  }, [handleNavigate, isLibraryPage, onOpenPlaylist, t]);
  const commandHandlers = useMemo<AppCommandHandlers>(() => ({
    trackCounts: { local: slots.local.tracks.length, cloud: slots.cloud.tracks.length, online: slots.online.tracks.length },
    switchSource,
    openPlaylist: openPlaylistInfo,
    importFiles: importVm.importClick,
    importDisabled: importVm.importDisabled,
    reloadFiles: importVm.reloadFiles,
    hasUnavailableTracks: activeTracks.some(track => track.available === false),
    playAll: shownTracks.length > 0 ? () => playShownTrack(0) : undefined,
    shuffleAll: shownTracks.length > 0 ? () => {
      player.setPlaybackMode('shuffle');
      playShownTrack(Math.floor(Math.random() * shownTracks.length));
    } : undefined,
    toggleFocusMode,
    togglePlaybackMode: player.togglePlaybackMode,
    toggleMute: player.toggleMute,
    openSettings: openSettingsSection,
    openWall,
  }), [
    activeTracks, importVm.importClick, importVm.importDisabled, importVm.reloadFiles, openPlaylistInfo,
    openSettingsSection, openWall, playShownTrack, player, shownTracks.length, slots.cloud.tracks.length,
    slots.local.tracks.length, slots.online.tracks.length, switchSource, toggleFocusMode,
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
        {!isWall && (
        <SidebarToggleButton
          onToggle={sidebar.toggleCollapsed}
          collapsed={sidebar.collapsed}
          isFocusMode={isFocusMode}
        />
        )}
        <div className="flex flex-1">
          {!isWall && (
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
          )}
        <main className={`flex-1 min-w-0 flex flex-col relative overflow-hidden ${isWall ? '' : 'pt-8'}`}
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
          <div ref={pageContentRef} className={`flex-1 overflow-hidden ${isWall ? '' : 'px-10 pt-2 pb-2'}`}>
            {viewMode === ViewMode.SETTINGS ? (
              <SettingsView key={settingsSection} initialSection={settingsSection} bottomInset={MACOS_PLAYER_BOTTOM_INSET} />
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
              {isWall ? (
                <LibraryWallView
                  tracks={isBrowsingPlaylist ? libraryBrowsingTracks : library.slots[library.viewSlot].tracks}
                  sourceKey={librarySourceKey}
                  dataSource={library.viewSlot}
                  currentTrackId={player.currentTrack?.id}
                  onTrackSelect={viewSlot === 'playlist' && libraryBrowsingTracks.length > 0
                    ? onPlayLibraryPlaylistTrack
                    : library.selectTrack}
                  onRemoveTrack={library.removeTrack}
                  onRemoveMultipleTracks={library.removeTracks}
                  onUpdateTrack={library.updateTrack}
                  onDownloadTrack={online.downloadTrack}
                  playlistLoading={viewSlot === 'playlist' && playlistState.isLoading}
                  playlistHasMore={viewSlot === 'playlist' && playlistState.hasMore}
                  playlistLoadError={viewSlot === 'playlist' ? playlistState.error : null}
                  onLoadMorePlaylist={viewSlot === 'playlist' ? playerController.loadMorePlaylistInLibrary : undefined}
                  pendingLocateSlot={pendingSlotLocate?.slot}
                  pendingLocateToken={pendingSlotLocate?.token}
                  onPendingLocatePrepared={handleSlotLocatePrepared}
                  chrome={wallChrome}
                />
              ) : (
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
              )}
              </div>
            )}
          </div>
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
      <CommandPalette commands={commands} library={paletteLibrary} />
    </>
  );
};

export default AppShell;
