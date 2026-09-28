import { useCallback, useEffect, useRef, useState } from 'react';
import { ViewMode } from '../types';
import type { SettingsSectionId } from '../components/settings/SettingsView';
import { useFloatingPanel } from '../hooks/useFloatingPanel';
import { useGsapButtonBounce } from '../hooks/useGsapButtonBounce';
import { useGsapPageTransition } from '../hooks/useGsapPageTransition';
import { useWindowFocus } from '../hooks/useWindowFocus';
import { settingsManager, type LibraryMode } from '../services/settingsManager';

export function useUIStore() {
  useGsapButtonBounce();

  // The poster wall is the home page; other pages open from the command palette.
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.WALL);
  const [isFocusMode, setIsFocusMode] = useState(false);
  // Settings float over the current wall instead of replacing it.
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  const [autoLocateToken, setAutoLocateToken] = useState(0);
  // Pending "locate now playing" for the wall; cleared once the wall has scrolled.
  const [locateRequest, setLocateRequest] = useState<number | null>(null);
  const locateTokenRef = useRef(0);
  const isWindowFocused = useWindowFocus();
  const floatingPanel = useFloatingPanel();
  const { containerRef: pageContentRef, navigate: transitionToView } = useGsapPageTransition(
    viewMode,
    setViewMode,
  );

  // Library page presentation: the poster wall (default) or the classic list.
  // Only an explicit switch persists it; page navigation never does.
  const [libraryLayout, setLibraryLayoutState] = useState<LibraryMode>(() => settingsManager.getLibraryMode());
  useEffect(() => {
    const sync = () => setLibraryLayoutState(settingsManager.getLibraryMode());
    void settingsManager.ensureLoaded?.().then(sync);
    return settingsManager.subscribe(sync);
  }, []);
  const setLibraryLayout = useCallback((layout: LibraryMode) => {
    setLibraryLayoutState(layout);
    void settingsManager.setLibraryMode(layout);
  }, []);

  const markTrackSwitch = useCallback(() => {
    setAutoLocateToken(prev => prev + 1);
  }, []);
  const requestLocate = useCallback(() => {
    setLocateRequest(++locateTokenRef.current);
  }, []);
  const handleLocateRequestHandled = useCallback((token: number) => {
    setLocateRequest(current => (current === token ? null : current));
  }, []);

  const handleNavigate = useCallback((mode: ViewMode) => {
    transitionToView(mode);
    setIsFocusMode(false);
    setSettingsSection(null);
  }, [transitionToView]);

  const openSettings = useCallback((section: SettingsSectionId = 'general') => {
    setSettingsSection(section);
    setIsFocusMode(false);
  }, []);
  const closeSettings = useCallback(() => setSettingsSection(null), []);

  return {
    viewMode,
    setViewMode,
    transitionToView,
    pageContentRef,
    isFocusMode,
    setIsFocusMode,
    autoLocateToken,
    markTrackSwitch,
    libraryLayout,
    setLibraryLayout,
    locateRequest,
    requestLocate,
    handleLocateRequestHandled,
    isWindowFocused,
    floatingPanel,
    handleNavigate,
    settingsSection,
    openSettings,
    closeSettings,
  };
}
