import React, { type ReactElement, useCallback, useMemo, useState } from 'react';
import { SlotId, ViewMode } from '../types';
import { useLibraryState } from '../stores/libraryState';
import type { PlaylistInfo } from '../services/online/onlineMusicProvider';
import TitleBar from './TitleBar';
import Controls from './Controls';
import FocusMode from './focus-mode/FocusMode';
import LibraryWallView from './library/LibraryWallView';
import LibraryView from './library/LibraryView';
import type { LibraryCollection } from './library/LibraryCollectionHeader';
import { toCoverThumb } from '../services/covers/coverUrl';
import DownloadStatusPill from './wall/DownloadStatusPill';
import WelcomePreview from './wall/WelcomePreview';
import SettingsSurface, { NativeSettingsPrewarm } from './settings/SettingsSurface';
import CommandPalette from './palette/CommandPalette';
import PlaylistSwitcher from './playlist-switcher/PlaylistSwitcher';
import type { PlaylistSwitchItem } from './playlist-switcher/types';
import type { PaletteLibrarySources } from './palette/usePaletteItems';
import { useAppCommands, type AppCommandHandlers } from '../commands/useAppCommands';
import type { PaletteSourceSlot } from '../commands/buildAppCommands';
import { useWindowVisible } from '../hooks/useWindowVisible';
import { notify } from '../services/notificationService';
import { useTranslation } from 'react-i18next';
import type { useAppUI } from '../hooks/useAppUI';
import type { useLibraryViewModel } from '../viewmodels/useLibraryViewModel';
import type { usePlayerViewModel } from '../viewmodels/usePlayerViewModel';
import type { useImportViewModel } from '../viewmodels/useImportViewModel';
import type { useOnlineViewModel } from '../viewmodels/useOnlineViewModel';
import type { useCloudViewModel } from '../viewmodels/useCloudViewModel';
import type { usePlaylistViewModel } from '../viewmodels/usePlaylistViewModel';

// The single application shell. AppContent owns wiring while this component
// remains presentational; all state and user intents arrive via props.
//
// Layout: the poster wall (library or search results) always fills the
// window. Settings float over it as a glass sheet, the control bar floats at
// the bottom, and every other entry point lives in the Cmd+K palette.

interface AppShellProps {
  ui: ReturnType<typeof useAppUI>;
  library: ReturnType<typeof useLibraryViewModel>;
  player: ReturnType<typeof usePlayerViewModel>;
  importVm: ReturnType<typeof useImportViewModel>;
  online: ReturnType<typeof useOnlineViewModel>;
  cloud: ReturnType<typeof useCloudViewModel>;
  // Playlist browse/play decoupling: the playlist being browsed on the wall
  // (viewSlot === 'playlist') is shown from its browsing tracks rather than
  // the 'playlist' play slot, so opening a playlist never interrupts playback.
  playlist: ReturnType<typeof usePlaylistViewModel>;
  // Slot state (slots, the play context and the browsed source) is read from
  // the library store; the props below are view wiring.
  pendingSlotLocate: { slot: SlotId; token: number } | null | undefined;
  handleSlotLocatePrepared: (token: number) => void;
  // The classic list view reports its own entrance, scroll offset and category.
  handleSlotContentReady: (slot: SlotId) => void;
  handleLibraryScrollPositionChange: (position: number) => void;
  handleCategoryChange: (selection: string | null) => void;
  libraryContentRef: React.RefObject<HTMLDivElement>;
  audioElement: ReactElement | null;
  isLinux: boolean;
}

const AppShell: React.FC<AppShellProps> = ({
  ui,
  library,
  player,
  importVm,
  online,
  cloud,
  playlist,
  pendingSlotLocate,
  handleSlotLocatePrepared,
  handleSlotContentReady,
  handleLibraryScrollPositionChange,
  handleCategoryChange,
  libraryContentRef,
  audioElement,
  isLinux,
}) => {
  const { t } = useTranslation();
  const slots = useLibraryState(state => state.slots);
  const viewSlot = useLibraryState(state => state.viewSlot);
  const activeTracks = useLibraryState(state => state.slots[state.activeSlotId].tracks);
  const windowVisible = useWindowVisible();
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

  // A browsed playlist always shows its own (possibly still loading) tracks,
  // never the previously played playlist held in the 'playlist' play slot.
  const playlistState = playlist.loadState;
  const isBrowsingPlaylist = viewSlot === 'playlist' && !!playlistState.playlistId;
  const shownTracks = isBrowsingPlaylist ? playlist.browsingTracks : library.slots[library.viewSlot].tracks;
  const playShownTrack = viewSlot === 'playlist' && playlist.browsingTracks.length > 0
    ? playlist.playTrack
    : library.selectTrack;
  // Identity of the shown list, used to restore the wall’s scroll position.
  const librarySourceKey = viewSlot === 'playlist' && playlistState.playlistId
    ? `playlist:${playlistState.source}:${playlistState.playlistId}`
    : viewSlot;

  const refreshCloudTracks = cloud.refresh;
  const refreshCloud = useCallback(() => {
    void refreshCloudTracks().catch(() => notify(t('settingsDialog.webdavTitle'), t('browse.error')));
  }, [refreshCloudTracks, t]);

  const [selectionRequest, setSelectionRequest] = useState(0);
  // Experimental settings can show the first-launch welcome page over a non-empty library.
  const [welcomePreview, setWelcomePreview] = useState(false);
  const selectTracks = useCallback(() => {
    setSelectionRequest(token => token + 1);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(current => !current);
  }, [setIsFocusMode]);

  const { activeSlotId, switchViewSlot } = library;
  const hasCloudConfig = cloud.hasConfig;
  const switchSource = useCallback((slot: PaletteSourceSlot) => {
    if (slot === 'cloud' && !hasCloudConfig()) {
      notify(t('settingsDialog.webdavTitle'), t('settingsDialog.webdavFillAll'));
      openSettings('cloud');
      return;
    }
    handleNavigate(ViewMode.WALL);
    void switchViewSlot(slot);
  }, [handleNavigate, hasCloudConfig, switchViewSlot, openSettings, t]);
  const openPlaylist = playlist.open;
  const openPlaylistInfo = useCallback((info: PlaylistInfo) => {
    handleNavigate(ViewMode.WALL);
    void openPlaylist(info.source, info.id, info.name, info.songCount)
      .catch(() => notify(t('playlists.title'), t('browse.error')));
  }, [handleNavigate, openPlaylist, t]);

  // Scroll the wall to the playing track, switching back from search results
  // or over to the source it plays from when the shown list lacks it.
  const currentTrackId = player.currentTrack?.id;
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
    refreshCloud: viewSlot === 'cloud' && hasCloudConfig() ? refreshCloud : undefined,
    playAll: shownTracks.length > 0 ? playAll : undefined,
    shuffleAll: shownTracks.length > 0 ? shuffleAll : undefined,
    locateCurrentTrack: currentTrackId ? locateCurrentTrack : undefined,
    toggleFocusMode,
    togglePlaybackMode: player.togglePlaybackMode,
    toggleMute: player.toggleMute,
    openSettings,
    libraryLayout,
    setLibraryLayout: switchLibraryLayout,
  }), [
    canManageShown, currentTrackId, hasCloudConfig, hasUnavailableTracks, locateCurrentTrack, importVm.importClick, importVm.importDisabled, importVm.reloadFiles,
    libraryLayout, openPlaylistInfo, openSettings, switchLibraryLayout, playShownTrack, player, refreshCloud, selectTracks,
    shownTracks.length, slots.cloud.tracks.length, slots.local.tracks.length, slots.online.tracks.length,
    switchSource, toggleFocusMode, viewSlot,
  ]);
  const { commands, visiblePlaylists } = useAppCommands(commandHandlers);
  const cloudConfigured = hasCloudConfig();
  const switcherItems = useMemo<PlaylistSwitchItem[]>(() => [
    ...(['local', 'cloud', 'online'] as const).filter(slot => slot !== 'cloud' || cloudConfigured).map(slot => ({
      id: `source:${slot}`,
      name: t(`sidebar.${slot}`),
      detail: t('playlistSwitcher.count', { count: slots[slot].tracks.length }),
      icon: slot === 'local' ? 'hard_drive' : slot === 'cloud' ? 'cloud' : 'history',
      run: () => switchSource(slot),
    })),
    ...visiblePlaylists.map(item => ({
      id: `playlist:${item.source}:${item.id}`,
      name: item.name,
      detail: t('playlistSwitcher.count', { count: item.songCount }),
      icon: 'queue_music',
      coverUrl: item.coverUrl,
      run: () => openPlaylistInfo(item),
    })),
  ], [cloudConfigured, openPlaylistInfo, slots.local.tracks.length, slots.cloud.tracks.length,
    slots.online.tracks.length, switchSource, t, visiblePlaylists]);
  // The list's Apple Music-style header: the browsed playlist, or the shown source.
  const listCollection = useMemo<LibraryCollection>(() => {
    if (viewSlot !== 'playlist') {
      return { title: t(`sidebar.${viewSlot}`), coverUrl: null, trackCount: shownTracks.length };
    }
    const shownPlaylist = visiblePlaylists.find(entry => entry.id === playlistState.playlistId && entry.source === playlistState.source);
    return {
      title: playlistState.title ?? shownPlaylist?.name ?? t('playlists.title'),
      coverUrl: shownPlaylist?.coverUrl ? toCoverThumb(shownPlaylist.coverUrl, 400) ?? null : null,
      trackCount: Math.max(playlistState.totalTrackCount ?? 0, shownTracks.length),
    };
  }, [playlistState.playlistId, playlistState.source, playlistState.title, playlistState.totalTrackCount,
    shownTracks.length, t, viewSlot, visiblePlaylists]);
  const paletteLibrary = useMemo<PaletteLibrarySources>(() => ({
    localTracks: slots.local.tracks,
    cloudTracks: slots.cloud.tracks,
    playlists: visiblePlaylists,
    playTrack: online.navigateToTrack,
    playOnlineSong: online.playSong,
    addOnlineSong: online.addSong,
    downloadOnlineSong: (song, source, quality) => { void online.download(song, quality, source); },
    openPlaylist: openPlaylistInfo,
  }), [online.addSong, online.download, online.navigateToTrack, online.playSong, openPlaylistInfo, slots.cloud.tracks, slots.local.tracks, visiblePlaylists]);

  return (
    <>
      {audioElement}
      <div className={`app-background ${libraryLayout === 'wall' ? 'app-wall-background' : 'app-library-background'} flex h-screen w-screen overflow-hidden font-sans relative${isLinux ? ' rounded-lg' : ''}`}>
        <TitleBar
          isFocusMode={isFocusMode}
          onToggleFocusMode={toggleFocusMode}
        />
        <main className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
          <input
            type="file"
            ref={importVm.fileInputRef}
            multiple
            accept=".flac,.mp3"
            className="hidden"
            onChange={importVm.onFileInputChange}
          />
          <div ref={pageContentRef} className="flex-1 overflow-hidden">
            <div ref={libraryContentRef} className="h-full">
              {libraryLayout === 'list' ? (
                <div className="h-full">
                  <LibraryView
                    tracks={shownTracks}
                    {...(player.currentTrack?.id != null && { currentTrackId: player.currentTrack.id })}
                    nowPlayingAnimated={player.isPlaying && !isFocusMode && windowVisible}
                    collection={listCollection}
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
                    onScrollPositionChange={handleLibraryScrollPositionChange}
                    autoLocateToken={autoLocateToken}
                    locateRequest={locateRequest}
                    onLocateRequestHandled={handleLocateRequestHandled}
                    importProgress={importVm.importProgress}
                    onSwitchSlot={library.switchViewSlot}
                    pendingLocateSlot={pendingSlotLocate?.slot}
                    pendingLocateToken={pendingSlotLocate?.token}
                    onPendingLocatePrepared={handleSlotLocatePrepared}
                    onSlotContentReady={handleSlotContentReady}
                    onCategoryChange={handleCategoryChange}
                    cloudLoadProgress={cloud.loadProgress}
                    onRefreshCloud={refreshCloudTracks}
                    {...(viewSlot === 'playlist' ? { onLoadMorePlaylist: playlist.loadMore } : {})}
                    playlistLoading={viewSlot === 'playlist' && playlistState.isLoading}
                    playlistHasMore={viewSlot === 'playlist' && playlistState.hasMore}
                    playlistLoadError={viewSlot === 'playlist' ? playlistState.error : null}
                  />
                </div>
              ) : (
                  <LibraryWallView
                    downloadProgress={online.progress}
                    tracks={shownTracks}
                    sourceKey={librarySourceKey}
                    dataSource={library.viewSlot}
                    currentTrackId={player.currentTrack?.id}
                    // FocusMode covers the wall, so its glow rests there; so does a hidden window.
                    nowPlayingAnimated={player.isPlaying && !isFocusMode && windowVisible}
                    onTrackSelect={playShownTrack}
                    onRemoveTrack={library.removeTrack}
                    onRemoveMultipleTracks={library.removeTracks}
                    onUpdateTrack={library.updateTrack}
                    onDownloadTrack={online.downloadTrack}
                    onSwapTracks={library.swap}
                    playlistLoading={viewSlot === 'playlist' && playlistState.isLoading}
                    playlistHasMore={viewSlot === 'playlist' && playlistState.hasMore}
                    playlistLoadError={viewSlot === 'playlist' ? playlistState.error : null}
                    onLoadMorePlaylist={viewSlot === 'playlist' ? playlist.loadMore : undefined}
                    pendingLocateSlot={pendingSlotLocate?.slot}
                    pendingLocateToken={pendingSlotLocate?.token}
                    onPendingLocatePrepared={handleSlotLocatePrepared}
                    autoLocateToken={autoLocateToken}
                    locateRequest={locateRequest}
                    onLocateRequestHandled={handleLocateRequestHandled}
                    savedScrollPosition={slots[viewSlot].scrollPosition}
                    onScrollPositionChange={handleLibraryScrollPositionChange}
                    importDisabled={importVm.importDisabled}
                    onImportClick={importVm.importClick}
                    onDropFiles={importVm.dropFiles}
                    onDropFilePaths={importVm.dropFilePaths}
                    importProgress={importVm.importProgress}
                    loadProgress={cloud.loadProgress}
                    selectionRequest={selectionRequest}
                  />
              )}
            </div>
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
        {settingsSection
          ? <SettingsSurface initialSection={settingsSection} onClose={closeSettings} onPreviewWelcome={() => setWelcomePreview(true)} />
          : <NativeSettingsPrewarm />}
        {welcomePreview && <WelcomePreview onClose={() => setWelcomePreview(false)} onImport={importVm.importClick} />}
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
      <PlaylistSwitcher items={switcherItems} activeId={viewSlot === 'playlist' ? librarySourceKey : `source:${viewSlot}`} />
    </>
  );
};

export default AppShell;
