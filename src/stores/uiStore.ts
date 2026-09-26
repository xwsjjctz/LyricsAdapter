import { useCallback, useEffect, useState } from 'react';
import { ViewMode } from '../types';
import { useFloatingPanel } from '../hooks/useFloatingPanel';
import { useGsapButtonBounce } from '../hooks/useGsapButtonBounce';
import { useGsapPageTransition } from '../hooks/useGsapPageTransition';
import { useWindowFocus } from '../hooks/useWindowFocus';
import { settingsManager } from '../services/settingsManager';

export function useUIStore() {
  useGsapButtonBounce();

  // Reopen in the library presentation that was showing when the app closed.
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (settingsManager.getLibraryMode() === 'wall' ? ViewMode.WALL : ViewMode.PLAYER),
  );
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [autoLocateToken, setAutoLocateToken] = useState(0);
  const isWindowFocused = useWindowFocus();
  const floatingPanel = useFloatingPanel();
  const { containerRef: pageContentRef, navigate: transitionToView } = useGsapPageTransition(
    viewMode,
    setViewMode,
  );

  // Only the two library presentations are remembered; settings and search are transient.
  useEffect(() => {
    if (viewMode === ViewMode.WALL) void settingsManager.setLibraryMode('wall');
    else if (viewMode === ViewMode.PLAYER) void settingsManager.setLibraryMode('list');
  }, [viewMode]);

  const markTrackSwitch = useCallback(() => {
    setAutoLocateToken(prev => prev + 1);
  }, []);

  const handleNavigate = useCallback((mode: ViewMode) => {
    transitionToView(mode);
    setIsFocusMode(false);
  }, [transitionToView]);

  return {
    viewMode,
    setViewMode,
    transitionToView,
    pageContentRef,
    isFocusMode,
    setIsFocusMode,
    autoLocateToken,
    markTrackSwitch,
    isWindowFocused,
    floatingPanel,
    handleNavigate,
  };
}
