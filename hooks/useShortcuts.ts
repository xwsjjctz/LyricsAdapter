import { useEffect, useCallback, useRef } from 'react';
import { logger } from '../services/logger';
import { shortcutManager, ShortcutAction } from '../services/shortcuts';
import { isDesktop } from '../services/desktopAdapter';
import { ViewMode } from '../types';

interface UseShortcutsProps {
  viewMode: ViewMode;
  isFocusMode: boolean;
  isPlaying: boolean;
  setIsFocusMode: (value: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  togglePlay: () => void;
  skipForward: () => void;
  skipBackward: () => void;
  handleSeek: (time: number) => void;
  volume: number;
  setVolume: (volume: number) => void;
  handleToggleMute: () => void;
  handleTogglePlaybackMode: () => void;
  onImportClick: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  currentTime: number;
  duration: number;
}

export const useShortcuts = ({
  viewMode,
  isFocusMode,
  isPlaying,
  setIsFocusMode,
  setViewMode,
  togglePlay,
  skipForward,
  skipBackward,
  handleSeek,
  volume,
  setVolume,
  handleToggleMute,
  handleTogglePlaybackMode,
  onImportClick,
  searchInputRef,
  currentTime,
  duration
}: UseShortcutsProps) => {
  const shortcutsRef = useRef(shortcutManager.getAllShortcuts());
  
  // Use refs to avoid stale closures for all values and callbacks
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const volumeRef = useRef(volume);
  const viewModeRef = useRef(viewMode);
  const isFocusModeRef = useRef(isFocusMode);
  const togglePlayRef = useRef(togglePlay);
  const skipForwardRef = useRef(skipForward);
  const skipBackwardRef = useRef(skipBackward);
  const handleSeekRef = useRef(handleSeek);
  const setVolumeRef = useRef(setVolume);
  const handleToggleMuteRef = useRef(handleToggleMute);
  const handleTogglePlaybackModeRef = useRef(handleTogglePlaybackMode);
  const onImportClickRef = useRef(onImportClick);
  const setIsFocusModeRef = useRef(setIsFocusMode);
  const setViewModeRef = useRef(setViewMode);
  
  // Update refs when values change
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { isFocusModeRef.current = isFocusMode; }, [isFocusMode]);
  useEffect(() => { togglePlayRef.current = togglePlay; }, [togglePlay]);
  useEffect(() => { skipForwardRef.current = skipForward; }, [skipForward]);
  useEffect(() => { skipBackwardRef.current = skipBackward; }, [skipBackward]);
  useEffect(() => { handleSeekRef.current = handleSeek; }, [handleSeek]);
  useEffect(() => { setVolumeRef.current = setVolume; }, [setVolume]);
  useEffect(() => { handleToggleMuteRef.current = handleToggleMute; }, [handleToggleMute]);
  useEffect(() => { handleTogglePlaybackModeRef.current = handleTogglePlaybackMode; }, [handleTogglePlaybackMode]);
  useEffect(() => { onImportClickRef.current = onImportClick; }, [onImportClick]);
  useEffect(() => { setIsFocusModeRef.current = setIsFocusMode; }, [setIsFocusMode]);
  useEffect(() => { setViewModeRef.current = setViewMode; }, [setViewMode]);

  // Keep shortcuts up to date
  useEffect(() => {
    const unsubscribe = shortcutManager.subscribe(() => {
      shortcutsRef.current = shortcutManager.getAllShortcuts();
    });
    return unsubscribe;
  }, []);

  const handleShortcut = useCallback((event: KeyboardEvent) => {
    // Debug log
    logger.debug('[Shortcuts] Key pressed:', event.key, 'code:', event.code, 'ctrl:', event.ctrlKey, 'meta:', event.metaKey, 'alt:', event.altKey);
    
    // Don't handle shortcuts when typing in input/textarea
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      logger.debug('[Shortcuts] Input focused, ignoring shortcut');
      return;
    }

    // Get current shortcuts config
    const shortcuts = shortcutsRef.current;

    // Check each shortcut
    for (const [action, config] of Object.entries(shortcuts)) {
      if (shortcutManager.matchesShortcut(action as ShortcutAction, event)) {
        logger.debug('[Shortcuts] Matched action:', action);
        event.preventDefault();
        handleAction(action as ShortcutAction);
        return;
      }
    }
  }, []);

  const handleAction = useCallback((action: ShortcutAction) => {
    logger.debug('[Shortcuts] Action triggered:', action);
    
    // Get current values and callbacks from refs to avoid stale closures
    const currentTime = currentTimeRef.current;
    const duration = durationRef.current;
    const volume = volumeRef.current;
    const viewMode = viewModeRef.current;
    const isFocusMode = isFocusModeRef.current;
    const togglePlay = togglePlayRef.current;
    const skipForward = skipForwardRef.current;
    const skipBackward = skipBackwardRef.current;
    const handleSeek = handleSeekRef.current;
    const setVolume = setVolumeRef.current;
    const handleToggleMute = handleToggleMuteRef.current;
    const handleTogglePlaybackMode = handleTogglePlaybackModeRef.current;
    const onImportClick = onImportClickRef.current;
    const setIsFocusMode = setIsFocusModeRef.current;
    const setViewMode = setViewModeRef.current;

    switch (action) {
      case 'playPause':
        togglePlay();
        break;

      case 'skipForward':
        skipForward();
        break;

      case 'skipBackward':
        skipBackward();
        break;

      case 'seekForward5s':
        handleSeek(Math.min(currentTime + 5, duration || Infinity));
        break;

      case 'seekBackward5s':
        handleSeek(Math.max(currentTime - 5, 0));
        break;

      case 'seekForward30s':
        handleSeek(Math.min(currentTime + 30, duration || Infinity));
        break;

      case 'seekBackward30s':
        handleSeek(Math.max(currentTime - 30, 0));
        break;

      case 'volumeUp':
        setVolume(Math.min(volume + 0.01, 1));
        break;

      case 'volumeDown':
        setVolume(Math.max(volume - 0.01, 0));
        break;

      case 'volumeUp10':
        setVolume(Math.min(volume + 0.1, 1));
        break;

      case 'volumeDown10':
        setVolume(Math.max(volume - 0.1, 0));
        break;

      case 'toggleMute':
        handleToggleMute();
        break;

      case 'togglePlaybackMode':
        handleTogglePlaybackMode();
        break;

      case 'enterFocusMode':
      case 'exitFocusMode':
        // Toggle focus mode with Enter key - now works in all views including browse
        setIsFocusMode(!isFocusMode);
        break;

      case 'focusSearch':
        // Focus the search input in sidebar
        const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
        break;

      case 'importFiles':
        onImportClick();
        break;

      case 'gotoLibrary':
        setViewMode(ViewMode.PLAYER);
        setIsFocusMode(false);
        break;

      case 'gotoBrowse':
        setViewMode(ViewMode.BROWSE);
        setIsFocusMode(false);
        break;

      case 'gotoSettings':
        setViewMode(ViewMode.SETTINGS);
        setIsFocusMode(false);
        break;

      case 'gotoTheme':
        setViewMode(ViewMode.THEME);
        setIsFocusMode(false);
        break;
    }
  }, []);

  // Subscribe to keyboard events
  useEffect(() => {
    // Use native keyboard events for both browser and desktop mode
    // This is more reliable than IPC for handling all keyboard shortcuts
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [handleShortcut]);

  return { handleShortcut };
};
