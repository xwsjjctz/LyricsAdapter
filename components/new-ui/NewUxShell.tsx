import React, { useCallback, useMemo, useState } from 'react';
import TitleBar from '../TitleBar';
import FocusMode from '../FocusMode';
import MainView from './MainView';
import PlaylistPanel from './PlaylistPanel';
import FloatingPlayerPanel from './FloatingPlayerPanel';
import PlaylistCardContextMenu from './PlaylistCardContextMenu';
import type { LibrarySlotsById, PlaylistEntry } from './types';
import type { SlotId, Track } from '../../types';
import { usePlaylistEntries } from '../../hooks/new-ui/usePlaylistEntries';
import { settingsManager } from '../../services/settingsManager';

interface NewUxShellProps {
  slots: LibrarySlotsById;
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
  onOpenSlot: (slotId: SlotId) => Promise<void>;
  onTrackSelect: (index: number) => void;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onTogglePlaybackMode: () => void;
  onImportIntoSlot: (slotId: SlotId) => Promise<void>;
  cloudImportDisabled: boolean;
  cloudImportDisabledReason?: string;
  audioRef?: React.RefObject<HTMLAudioElement>;
  setAudioRef: (node: HTMLAudioElement | null) => void;
  onTimeUpdate: React.ReactEventHandler<HTMLAudioElement>;
  onLoadedMetadata: React.ReactEventHandler<HTMLAudioElement>;
  onTrackEnded: React.ReactEventHandler<HTMLAudioElement>;
  onCanPlay: React.ReactEventHandler<HTMLAudioElement>;
  onAudioError: React.ReactEventHandler<HTMLAudioElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const NewUxShell: React.FC<NewUxShellProps> = ({
  slots,
  currentTrack,
  isPlaying,
  currentTime,
  volume,
  playbackMode,
  isFocusMode,
  onToggleFocusMode,
  onOpenSlot,
  onTrackSelect,
  onTogglePlay,
  onSkipNext,
  onSkipPrev,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onTogglePlaybackMode,
  onImportIntoSlot,
  cloudImportDisabled,
  cloudImportDisabledReason,
  audioRef,
  setAudioRef,
  onTimeUpdate,
  onLoadedMetadata,
  onTrackEnded,
  onCanPlay,
  onAudioError,
  fileInputRef,
  onFileInputChange,
}) => {
  const entries = usePlaylistEntries(slots);
  const [openPlaylistId, setOpenPlaylistId] = useState<SlotId | null>(null);
  const [playlistMenu, setPlaylistMenu] = useState<{
    entry: PlaylistEntry;
    x: number;
    y: number;
  } | null>(null);

  const openEntry = useMemo(
    () => entries.find(entry => entry.id === openPlaylistId) ?? null,
    [entries, openPlaylistId]
  );

  const handleOpenPlaylist = useCallback(async (entry: PlaylistEntry) => {
    await onOpenSlot(entry.id);
    setOpenPlaylistId(entry.id);
  }, [onOpenSlot]);

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

  return (
    <div className="new-ux-shell font-sans">
      <TitleBar isFocusMode={isFocusMode} onToggleFocusMode={onToggleFocusMode} />
      {currentTrack && (
        <audio
          ref={setAudioRef}
          src={currentTrack.audioUrl}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onLoadedData={onLoadedMetadata}
          onEnded={onTrackEnded}
          onCanPlay={onCanPlay}
          onError={onAudioError}
        />
      )}
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
            {openEntry && (
              <PlaylistPanel
                entry={openEntry}
                {...(currentTrack?.id ? { currentTrackId: currentTrack.id } : {})}
                onClose={() => setOpenPlaylistId(null)}
                onTrackSelect={onTrackSelect}
              />
            )}
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
          onClose={() => setPlaylistMenu(null)}
        />
      )}
      <FloatingPlayerPanel
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        onTogglePlay={onTogglePlay}
        onSkipNext={onSkipNext}
        onSkipPrev={onSkipPrev}
        onSeek={onSeek}
        onToggleFocus={onToggleFocusMode}
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
        {...(audioRef ? { audioRef } : {})}
      />
    </div>
  );
};

export default NewUxShell;
