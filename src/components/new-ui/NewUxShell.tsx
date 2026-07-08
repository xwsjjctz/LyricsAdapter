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
import SettingsPanel from './SettingsPanel';
import ThemePanel from './ThemePanel';
import NewUxSearchBox from './NewUxSearchBox';
import LocateNowPlayingButton from './LocateNowPlayingButton';
import RightDrawer from './RightDrawer';
import {
  loadCardOverrides,
  loadBgImage,
  loadBgBlur,
  saveBgImage,
  saveBgBlur,
  setCardOverride,
  type CardOverrideMap,
} from '../../services/newUxCardEdit';
import FocusAmbientLight from './focus/FocusAmbientLight';
import type { CardEntry, LibrarySlotsById } from './types';
import type { SlotId, Track } from '../../types';
import type { OnlineSong } from '../../services/onlineMusicProvider';
import { i18n } from '../../services/i18n';
import { useNewUxStore } from '../../stores/newUxStore';
import { useNowPlayingLocator } from '../../hooks/new-ui/useNowPlayingLocator';
import { usePlaylistEntries } from '../../hooks/new-ui/usePlaylistEntries';
import { useOnlinePlaylists } from '../../hooks/new-ui/useOnlinePlaylists';

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
  onTrackSelect: (index: number, slotId?: SlotId) => void;
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
  onOpenOnlinePlaylist: (source: 'qq' | 'netease', playlistId: string, name: string) => Promise<void>;
  /** Tracks browsed by opening a third-party playlist card (browse/play decoupled
   *  from the 'playlist' play slot so opening a card never pauses playback). */
  browsingTracks: Track[];
  /** Start playback of a browsed third-party playlist at the clicked index. */
  onPlayBrowsingTrack: (index: number) => void;
  onClearOrphanCache?: () => Promise<{ metadataDeleted: number; coversDeleted: number; errors: string[] }>;
  isWindowFocused?: boolean;
  onNavigateToTrack: (track: Track) => void;
  onOnlineDownload: (song: OnlineSong, quality: '128' | '320' | 'flac') => void;
  onOnlineUpload: (song: OnlineSong, quality: '128' | '320' | 'flac') => void;
  onOnlineStreamPlay: (song: OnlineSong, source: 'qq' | 'netease') => void;
  onlineProgress: Record<string, { type: 'download' | 'upload'; percent: number }>;
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
  onOpenOnlinePlaylist,
  browsingTracks,
  onPlayBrowsingTrack,
  onClearOrphanCache,
  isWindowFocused,
  onNavigateToTrack,
  onOnlineDownload,
  onOnlineUpload,
  onOnlineStreamPlay,
  onlineProgress,
  cloudImportDisabled,
  cloudImportDisabledReason,
  audioRef,
  fileInputRef,
  onFileInputChange,
}) => {
  const { playlists: onlinePlaylists } = useOnlinePlaylists();
  const entries = usePlaylistEntries(slots, onlinePlaylists);
  const panels = useNewUxStore();
  const playerTransitionRef = useRef<HTMLDivElement | null>(null);

  // ── Card edit mode ──
  const [isCardEditMode, setIsCardEditMode] = useState(false);
  const [cardOverrides, setCardOverrides] = useState<CardOverrideMap>({});
  const [bgImage, setBgImage] = useState('');
  const [bgBlur, setBgBlur] = useState(80);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // ── Left panel state machine (mutual exclusivity + exit animation) ──
  const [activePanel, setActivePanel] = useState<'hidden' | 'bg' | null>(null);
  const [exitingPanel, setExitingPanel] = useState<'hidden' | 'bg' | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleLeftPanel = useCallback((panel: 'hidden' | 'bg') => {
    // Cancel any pending exit timer to prevent stale callbacks
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    setActivePanel(current => {
      if (current === panel) {
        // Toggle off: start exit animation, clear after 220ms
        setExitingPanel(panel);
        exitTimerRef.current = setTimeout(() => {
          setExitingPanel(null);
          exitTimerRef.current = null;
        }, 220);
        return null;
      } else if (current !== null) {
        // Switch: exit current immediately, show new one
        setExitingPanel(current);
        exitTimerRef.current = setTimeout(() => {
          setExitingPanel(null);
          exitTimerRef.current = null;
        }, 220);
        return panel;
      } else {
        // Open fresh (no current panel, or previous already exited)
        setExitingPanel(null);
        return panel;
      }
    });
  }, []);

  useEffect(() => {
    loadCardOverrides().then(setCardOverrides);
    loadBgImage().then(setBgImage);
    loadBgBlur().then(setBgBlur);
  }, []);

  // Auto-show hidden tray when entering edit mode with hidden cards,
  // auto-hide when leaving edit mode or all cards become visible.
  const hasHiddenCards = Object.values(cardOverrides).some(o => o.hidden);
  useEffect(() => {
    if (isCardEditMode && hasHiddenCards && activePanel === null && exitingPanel === null) {
      setActivePanel('hidden');
    } else if ((!isCardEditMode || !hasHiddenCards) && activePanel === 'hidden') {
      setExitingPanel('hidden');
      setActivePanel(null);
      exitTimerRef.current = setTimeout(() => {
        setExitingPanel(null);
        exitTimerRef.current = null;
      }, 220);
    }
  }, [isCardEditMode, hasHiddenCards, activePanel, exitingPanel]);
  const [isCurrentTrackVisible, setIsCurrentTrackVisible] = useState(false);
  const [locateRequest, setLocateRequest] = useState<{ trackId: string | null; token: number }>({
    trackId: null,
    token: 0,
  });
  const [playlistMenu, setPlaylistMenu] = useState<{
    entry: CardEntry;
    x: number;
    y: number;
  } | null>(null);

  // Resolve the currently open card and the tracks to display in its panel.
  // Tracks are fetched from the backing slot on demand: slot cards read their
  // own slot; third-party playlist cards read the independent browsingTracks
  // state (NOT the 'playlist' play slot — opening a card must not disturb
  // whatever is currently playing). Overlay cards never reach here because they
  // open via openOverlayPanel, not openPlaylistId.
  const openPanel = useMemo<{ entry: CardEntry; tracks: Track[] } | null>(() => {
    const openId = panels.state.openPlaylistId;
    if (!openId) return null;
    const entry = entries.find(item => item.id === openId) ?? null;
    if (!entry) return null;
    if (entry.kind === 'slot') {
      return { entry, tracks: slots[entry.slotId].tracks };
    }
    if (entry.kind === 'online-playlist') {
      return { entry, tracks: browsingTracks };
    }
    // overlay cards are not opened through openPlaylistId
    return null;
  }, [entries, panels.state.openPlaylistId, slots, browsingTracks]);
  const openTracks = openPanel?.tracks ?? [];
  // The slot the open panel's tracks belong to. Slot cards → their own slot.
  // Third-party playlist cards have no backing slot until the user plays one —
  // returning null keeps handlePanelTrackSelect on the browsing-play path.
  const openPanelSlotId = useMemo<SlotId | null>(() => {
    const entry = openPanel?.entry;
    if (!entry) return null;
    return entry.kind === 'slot' ? entry.slotId : null;
  }, [openPanel]);
  const handlePanelTrackSelect = useCallback((index: number) => {
    // Slot cards select into their slot directly; third-party playlist cards
    // (openPanelSlotId null) start playback via the browsing-play handler,
    // which loads the browsed list into the 'playlist' slot on demand.
    if (openPanelSlotId) {
      onTrackSelect(index, openPanelSlotId);
    } else {
      onPlayBrowsingTrack(index);
    }
  }, [onTrackSelect, onPlayBrowsingTrack, openPanelSlotId]);
  const trackMenuTrack = useMemo(() => {
    if (!openPanel || !panels.state.trackMenu) return null;
    return openTracks.find(track => track.id === panels.state.trackMenu?.trackId) ?? null;
  }, [openPanel, openTracks, panels.state.trackMenu]);
  const editingTrack = useMemo(() => {
    if (!openPanel || !panels.state.editingTrackId) return null;
    return openTracks.find(track => track.id === panels.state.editingTrackId) ?? null;
  }, [openPanel, openTracks, panels.state.editingTrackId]);
  const deleteTracks = useMemo(() => {
    if (!openPanel || panels.state.deleteTargetIds.length === 0) return [];
    const targetIds = new Set(panels.state.deleteTargetIds);
    return openTracks.filter(track => targetIds.has(track.id));
  }, [openPanel, openTracks, panels.state.deleteTargetIds]);
  const openSlotId = useMemo<SlotId | null>(() => {
    const openId = panels.state.openPlaylistId;
    if (openId === 'local' || openId === 'cloud' || openId === 'online' || openId === 'playlist') {
      return openId;
    }
    return null;
  }, [panels.state.openPlaylistId]);
  const nowPlayingLocator = useNowPlayingLocator({
    entries,
    slots,
    currentTrack,
    activeSlotId,
    openPlaylistId: openSlotId,
    isCurrentTrackVisible,
  });
  const focusAmbientLayer = useMemo(
    () => <FocusAmbientLight track={currentTrack} isPlaying={isPlaying} />,
    [currentTrack, isPlaying]
  );
  const shellStyle = useMemo(() => ({
    '--new-ux-glass-backdrop-image': bgImage ? `url("${bgImage}")` : 'none',
    '--new-ux-glass-backdrop-opacity': bgImage ? '0.38' : '0',
  }) as React.CSSProperties, [bgImage]);

  useEffect(() => {
    setIsCurrentTrackVisible(false);
  }, [currentTrack?.id, panels.state.openPlaylistId]);

  const handleOpenPlaylist = useCallback(async (entry: CardEntry) => {
    // Overlay cards (settings/theme) open a floating panel instead of a slot.
    if (entry.kind === 'overlay') {
      if (entry.overlay === 'settings') {
        panels.openSettings();
      } else {
        panels.openTheme();
      }
      setPlaylistMenu(null);
      return;
    }
    // Third-party playlist card: load its songs into the playlist slot, then
    // open the playlist panel keyed by the card id.
    if (entry.kind === 'online-playlist') {
      await onOpenOnlinePlaylist(entry.source, entry.playlistId, entry.title);
      panels.openPlaylist(entry.id);
      setPlaylistMenu(null);
      return;
    }
    // Slot-backed cards (local/cloud/online). kind === 'slot' → slotId.
    await onOpenSlot(entry.slotId);
    panels.openPlaylist(entry.slotId);
    setPlaylistMenu(null);
  }, [onOpenSlot, onOpenOnlinePlaylist, panels]);

  const handlePlaylistContextMenu = useCallback((entry: CardEntry, event: React.MouseEvent) => {
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

    // targetEntry is narrowed to a slot card by useNowPlayingLocator.
    const slotId = targetEntry.slotId;
    await onOpenSlot(slotId);
    panels.openPlaylist(slotId);
    setPlaylistMenu(null);
    setIsCurrentTrackVisible(false);
    setLocateRequest(prev => ({
      trackId: targetTrackId,
      token: prev.token + 1,
    }));
  }, [nowPlayingLocator, onOpenSlot, panels]);

  const handleOpenFocusMode = useCallback(() => {
    if (!currentTrack) return;
    onToggleFocusMode();
  }, [currentTrack, onToggleFocusMode]);

  return (
    <div className="new-ux-shell font-sans" style={shellStyle}>
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
        {/* The big title and the top-right "exit new UI" button were removed.
            Exiting back to the legacy UI is exposed from the Settings card (see
            SettingsPanel) to keep the chrome minimal. */}
      </div>
      {bgImage && (
        <div
          className="new-ux-bg-image"
          style={{
            backgroundImage: `url(${bgImage})`,
            filter: `blur(${bgBlur}px)`,
            transform: 'scale(1.1)',
          }}
        />
      )}
      <NewUxSearchBox
        {...(isWindowFocused !== undefined ? { isWindowFocused } : {})}
        localTracks={slots.local.tracks}
        cloudTracks={slots.cloud.tracks}
        onNavigateToTrack={onNavigateToTrack}
        onOnlineDownload={onOnlineDownload}
        onOnlineUpload={onOnlineUpload}
        onOnlineStreamPlay={onOnlineStreamPlay}
        onlineProgress={onlineProgress}
      />
      <main className="new-ux-main">
        <div className="new-ux-stage">
          <MainView
            entries={entries}
            isPlaylistPanelOpen={Boolean(openPanel) || Boolean(panels.state.openOverlayPanel)}
            onOpenPlaylist={handleOpenPlaylist}
            onPlaylistContextMenu={handlePlaylistContextMenu}
            isCardEditMode={isCardEditMode}
            cardOverrides={cardOverrides}
            onCardOverrideChange={async (entryId, patch) => {
              const next = await setCardOverride(entryId, patch);
              setCardOverrides(next);
            }}
            activePanel={activePanel}
            exitingPanel={exitingPanel}
          />
          <div className="new-ux-panel-layer">
            <PanelStack>
              {openPanel && (
                <PlaylistPanel
                  title={openPanel.entry.title}
                  tracks={openTracks}
                  {...(currentTrack?.id ? { currentTrackId: currentTrack.id } : {})}
                  isEditMode={panels.state.isEditMode}
                  selectedTrackIds={panels.state.selectedTrackIds}
                  {...(locateRequest.trackId ? { locateTrackId: locateRequest.trackId } : {})}
                  locateToken={locateRequest.token}
                  onClose={panels.closePlaylist}
                  onTrackSelect={handlePanelTrackSelect}
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
              {panels.state.openOverlayPanel === 'settings' && (
                <SettingsPanel
                  onClose={panels.closeOverlay}
                  {...(onClearOrphanCache ? { onClearOrphanCache } : {})}
                />
              )}
              {panels.state.openOverlayPanel === 'theme' && (
                <ThemePanel onClose={panels.closeOverlay} />
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
          slots={slots}
          x={playlistMenu.x}
          y={playlistMenu.y}
          cloudImportDisabled={cloudImportDisabled}
          {...(cloudImportDisabledReason ? { cloudImportDisabledReason } : {})}
          onOpen={handleOpenPlaylist}
          onImport={handleImport}
          onReloadUnavailable={onReloadUnavailable}
          onOpenSettings={panels.openSettings}
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
          onPlay={() => handlePanelTrackSelect(panels.state.trackMenu?.trackIndex ?? 0)}
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
      <RightDrawer
        isCardEditMode={isCardEditMode}
        onToggleCardEditMode={() => setIsCardEditMode(v => !v)}
        onOpenSettings={panels.openSettings}
        onOpenTheme={panels.openTheme}
        showBgSettings={activePanel === 'bg'}
        onToggleBgSettings={() => toggleLeftPanel('bg')}
      />

      {/* Left-side background settings panel */}
      {(activePanel === 'bg' || exitingPanel === 'bg') && (
        <div className={`new-ux-bg-tray${exitingPanel === 'bg' ? ' new-ux-tray--exiting' : ''}`}>
          <div className="new-ux-bg-tray__header">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>image</span>
            {i18n.t('newui.bgSettings')}
          </div>
          <div className="new-ux-bg-tray__body">
            <div className="new-ux-bg-settings__label">{i18n.t('newui.bgImage')}</div>
            <div className="new-ux-bg-settings__row">
              <button
                className="new-ux-bg-tray__btn"
                onClick={() => bgInputRef.current?.click()}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>upload</span>
                {i18n.t('newui.pickImage')}
              </button>
              {bgImage && (
                <button
                  className="new-ux-bg-tray__btn"
                  onClick={() => { setBgImage(''); saveBgImage(''); }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                  {i18n.t('newui.clear')}
                </button>
              )}
            </div>
            {bgImage && (
              <div className="new-ux-bg-tray__preview">
                <img src={bgImage} alt="" />
              </div>
            )}
            <div className="new-ux-bg-settings__label" style={{ marginTop: 14 }}>{i18n.t('newui.blurRadius')}</div>
            <div className="new-ux-bg-settings__row">
              <input
                type="range"
                min={0}
                max={200}
                value={bgBlur}
                onChange={e => { const v = Number(e.target.value); setBgBlur(v); saveBgBlur(v); }}
                className="new-ux-bg-settings__slider"
              />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 36, textAlign: 'right' }}>
                {bgBlur}px
              </span>
            </div>
          </div>
        </div>
      )}

      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => { const d = reader.result as string; setBgImage(d); saveBgImage(d); };
          reader.readAsDataURL(file);
          e.target.value = '';
        }}
      />
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
