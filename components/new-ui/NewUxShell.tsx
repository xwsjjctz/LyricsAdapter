import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TitleBar from '../TitleBar';
import FocusMode from '../FocusMode';
import MainView from './MainView';
import PlaylistPanel from './PlaylistPanel';
import FloatingPlayerPanel from './FloatingPlayerPanel';
import PlaylistCardContextMenu from './PlaylistCardContextMenu';
import PanelStack from './PanelStack';
import TrackContextMenu from './TrackContextMenu';
import DeleteConfirmPanel from './DeleteConfirmPanel';
import MetadataEditPanel from './MetadataEditPanel';
import LocateNowPlayingButton from './LocateNowPlayingButton';
import FocusAmbientLight from './focus/FocusAmbientLight';
import type { LibrarySlotsById, PlaylistEntry } from './types';
import type { SlotId, Track } from '../../types';
import { useNewUxPanels } from '../../hooks/new-ui/useNewUxPanels';
import { useNowPlayingLocator } from '../../hooks/new-ui/useNowPlayingLocator';
import { usePlaylistEntries } from '../../hooks/new-ui/usePlaylistEntries';
import { settingsManager } from '../../services/settingsManager';

interface NewUxShellProps {
  slots: LibrarySlotsById;
  activeSlotId: SlotId;
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
  onOpenSlot: (slotId: SlotId) => Promise<void>;
  onTrackSelect: (index: number) => void;
  onRemoveTrack: (trackId: string, deleteFile?: boolean) => Promise<void>;
  onRemoveMultipleTracks: (trackIds: string[], deleteFile?: boolean) => Promise<void>;
  onUpdateTrack: (track: Track) => void;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onTogglePlaybackMode: () => void;
  onImportIntoSlot: (slotId: SlotId) => Promise<void>;
  onReloadUnavailable: () => void;
  onOpenSettings: () => void;
  cloudImportDisabled: boolean;
  cloudImportDisabledReason?: string;
  audioRef?: React.RefObject<HTMLAudioElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const NewUxShell: React.FC<NewUxShellProps> = ({
  slots,
  activeSlotId,
  currentTrack,
  isPlaying,
  currentTime,
  volume,
  playbackMode,
  isFocusMode,
  onToggleFocusMode,
  onOpenSlot,
  onTrackSelect,
  onRemoveTrack,
  onRemoveMultipleTracks,
  onUpdateTrack,
  onTogglePlay,
  onSkipNext,
  onSkipPrev,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onTogglePlaybackMode,
  onImportIntoSlot,
  onReloadUnavailable,
  onOpenSettings,
  cloudImportDisabled,
  cloudImportDisabledReason,
  audioRef,
  fileInputRef,
  onFileInputChange,
}) => {
  const entries = usePlaylistEntries(slots);
  const panels = useNewUxPanels();
  const playerTransitionRef = useRef<HTMLDivElement | null>(null);
  const [isCurrentTrackVisible, setIsCurrentTrackVisible] = useState(false);
  const [locateRequest, setLocateRequest] = useState<{ trackId: string | null; token: number }>({
    trackId: null,
    token: 0,
  });
  const [playlistMenu, setPlaylistMenu] = useState<{
    entry: PlaylistEntry;
    x: number;
    y: number;
  } | null>(null);

  const openEntry = useMemo(
    () => entries.find(entry => entry.id === panels.state.openPlaylistId) ?? null,
    [entries, panels.state.openPlaylistId]
  );
  const trackMenuTrack = useMemo(() => {
    if (!openEntry || !panels.state.trackMenu) return null;
    return openEntry.tracks.find(track => track.id === panels.state.trackMenu?.trackId) ?? null;
  }, [openEntry, panels.state.trackMenu]);
  const editingTrack = useMemo(() => {
    if (!openEntry || !panels.state.editingTrackId) return null;
    return openEntry.tracks.find(track => track.id === panels.state.editingTrackId) ?? null;
  }, [openEntry, panels.state.editingTrackId]);
  const deleteTracks = useMemo(() => {
    if (!openEntry || panels.state.deleteTargetIds.length === 0) return [];
    const targetIds = new Set(panels.state.deleteTargetIds);
    return openEntry.tracks.filter(track => targetIds.has(track.id));
  }, [openEntry, panels.state.deleteTargetIds]);
  const nowPlayingLocator = useNowPlayingLocator({
    entries,
    currentTrack,
    activeSlotId,
    openPlaylistId: panels.state.openPlaylistId,
    isCurrentTrackVisible,
  });
  const focusAmbientLayer = useMemo(
    () => <FocusAmbientLight track={currentTrack} isPlaying={isPlaying} />,
    [currentTrack, isPlaying]
  );

  useEffect(() => {
    setIsCurrentTrackVisible(false);
  }, [currentTrack?.id, panels.state.openPlaylistId]);

  const handleOpenPlaylist = useCallback(async (entry: PlaylistEntry) => {
    await onOpenSlot(entry.id);
    panels.openPlaylist(entry.id);
    setPlaylistMenu(null);
  }, [onOpenSlot, panels]);

  const handlePlaylistContextMenu = useCallback((entry: PlaylistEntry, event: React.MouseEvent) => {
    event.preventDefault();
    setPlaylistMenu({
      entry,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const handleImport = useCallback(async (slotId: SlotId) => {
    await onImportIntoSlot(slotId);
  }, [onImportIntoSlot]);

  const handleTrackContextMenu = useCallback((track: Track, index: number, event: React.MouseEvent) => {
    event.preventDefault();
    panels.openTrackMenu({
      trackId: track.id,
      trackIndex: index,
      x: event.clientX,
      y: event.clientY,
    });
  }, [panels]);

  const getDeleteTargetIds = useCallback((fallbackTrackId: string) => {
    if (panels.state.isEditMode && panels.state.selectedTrackIds.size > 0) {
      return Array.from(panels.state.selectedTrackIds);
    }
    return [fallbackTrackId];
  }, [panels.state.isEditMode, panels.state.selectedTrackIds]);

  const handleConfirmDelete = useCallback(async (deleteFiles: boolean) => {
    const ids = panels.state.deleteTargetIds;
    if (ids.length === 0) return;

    if (ids.length === 1) {
      const trackId = ids[0];
      if (!trackId) return;
      await onRemoveTrack(trackId, deleteFiles);
    } else {
      await onRemoveMultipleTracks(ids, deleteFiles);
    }
    panels.closeDeleteConfirm();
    panels.exitEditMode();
  }, [onRemoveMultipleTracks, onRemoveTrack, panels]);

  const handleSaveMetadata = useCallback((track: Track) => {
    onUpdateTrack(track);
    panels.closeMetadata();
  }, [onUpdateTrack, panels]);

  const handleLocateNowPlaying = useCallback(async () => {
    const { targetEntry, targetTrackId } = nowPlayingLocator;
    if (!targetEntry || !targetTrackId) return;

    await onOpenSlot(targetEntry.id);
    panels.openPlaylist(targetEntry.id);
    setPlaylistMenu(null);
    setIsCurrentTrackVisible(false);
    setLocateRequest(prev => ({
      trackId: targetTrackId,
      token: prev.token + 1,
    }));
  }, [nowPlayingLocator, onOpenSlot, panels]);

  const handleOpenFocusMode = useCallback(() => {
    if (!currentTrack) return;
    // The cover-to-focus flying animation is intentionally removed for now and will be
    // rebuilt later. Clicking the cover simply toggles focus mode directly.
    onToggleFocusMode();
  }, [currentTrack, onToggleFocusMode]);

  return (
    <div className="new-ux-shell font-sans">
      <TitleBar isFocusMode={isFocusMode} onToggleFocusMode={onToggleFocusMode} />
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept=".flac,.mp3"
        className="hidden"
        onChange={onFileInputChange}
      />
      <div className="new-ux-chrome-layer">
        <header className="new-ux-mainview__header">
          <div>
            <h1 className="new-ux-mainview__title">Lyrics Adapter</h1>
          </div>
          <button type="button" className="new-ux-button-reset new-ux-icon-button" onClick={() => settingsManager.setNewUxEnabled(false)} aria-label="Exit new UI">
            <span className="material-symbols-outlined text-[22px]">logout</span>
          </button>
        </header>
      </div>
      <main className="new-ux-main">
        <div className="new-ux-stage">
          <MainView
            entries={entries}
            isPlaylistPanelOpen={Boolean(openEntry)}
            onOpenPlaylist={handleOpenPlaylist}
            onPlaylistContextMenu={handlePlaylistContextMenu}
          />
          <div className="new-ux-panel-layer">
            <PanelStack>
              {openEntry && (
                <PlaylistPanel
                  entry={openEntry}
                  {...(currentTrack?.id ? { currentTrackId: currentTrack.id } : {})}
                  isEditMode={panels.state.isEditMode}
                  selectedTrackIds={panels.state.selectedTrackIds}
                  {...(locateRequest.trackId ? { locateTrackId: locateRequest.trackId } : {})}
                  locateToken={locateRequest.token}
                  onClose={panels.closePlaylist}
                  onTrackSelect={onTrackSelect}
                  onTrackContextMenu={handleTrackContextMenu}
                  onToggleTrackSelected={panels.toggleTrackSelected}
                  onSelectAll={panels.selectAll}
                  onExitEditMode={panels.exitEditMode}
                  onDeleteSelected={() => panels.openDeleteConfirm(Array.from(panels.state.selectedTrackIds))}
                  onCurrentTrackVisibilityChange={setIsCurrentTrackVisible}
                />
              )}
              {editingTrack && (
                <MetadataEditPanel
                  track={editingTrack}
                  onClose={panels.closeMetadata}
                  onSave={handleSaveMetadata}
                />
              )}
              {deleteTracks.length > 0 && (
                <DeleteConfirmPanel
                  tracks={deleteTracks}
                  onCancel={panels.closeDeleteConfirm}
                  onConfirm={handleConfirmDelete}
                />
              )}
            </PanelStack>
          </div>
        </div>
      </main>
      {playlistMenu && (
        <PlaylistCardContextMenu
          entry={playlistMenu.entry}
          x={playlistMenu.x}
          y={playlistMenu.y}
          cloudImportDisabled={cloudImportDisabled}
          {...(cloudImportDisabledReason ? { cloudImportDisabledReason } : {})}
          onOpen={handleOpenPlaylist}
          onImport={handleImport}
          onReloadUnavailable={onReloadUnavailable}
          onOpenSettings={onOpenSettings}
          onClose={() => setPlaylistMenu(null)}
        />
      )}
      {panels.state.trackMenu && trackMenuTrack && (
        <TrackContextMenu
          track={trackMenuTrack}
          x={panels.state.trackMenu.x}
          y={panels.state.trackMenu.y}
          isEditMode={panels.state.isEditMode}
          selectedCount={panels.state.selectedTrackIds.size}
          onPlay={() => onTrackSelect(panels.state.trackMenu?.trackIndex ?? 0)}
          onEditMetadata={() => panels.openMetadata(trackMenuTrack.id)}
          onDelete={() => panels.openDeleteConfirm(getDeleteTargetIds(trackMenuTrack.id))}
          onEnterEditMode={() => panels.enterEditMode(trackMenuTrack.id)}
          onExitEditMode={panels.exitEditMode}
          onClose={panels.closeTrackMenu}
        />
      )}
      {currentTrack && nowPlayingLocator.visible && (
        <LocateNowPlayingButton track={currentTrack} onLocate={handleLocateNowPlaying} />
      )}
      <FloatingPlayerPanel
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        volume={volume}
        playbackMode={playbackMode}
        transitionRef={playerTransitionRef}
        onTogglePlay={onTogglePlay}
        onSkipNext={onSkipNext}
        onSkipPrev={onSkipPrev}
        onSeek={onSeek}
        onVolumeChange={onVolumeChange}
        onToggleMute={onToggleMute}
        onTogglePlaybackMode={onTogglePlaybackMode}
        onToggleFocus={handleOpenFocusMode}
      />
      <FocusMode
        track={currentTrack}
        isVisible={isFocusMode}
        currentTime={currentTime}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onSkipNext={onSkipNext}
        onSkipPrev={onSkipPrev}
        onSeek={onSeek}
        volume={volume}
        onVolumeChange={onVolumeChange}
        onToggleMute={onToggleMute}
        playbackMode={playbackMode}
        onTogglePlaybackMode={onTogglePlaybackMode}
        onToggleFocus={onToggleFocusMode}
        ambientLayer={focusAmbientLayer}
        variant="new-ux"
        {...(audioRef ? { audioRef } : {})}
      />
    </div>
  );
};

export default NewUxShell;
