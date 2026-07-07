import { useCallback, useRef, useState } from 'react';
import { ViewMode } from '../types';
import { useFloatingPanel } from '../hooks/useFloatingPanel';
import { useGlassUI } from '../hooks/useGlassUI';
import { useGsapButtonBounce } from '../hooks/useGsapButtonBounce';
import { useGsapPageTransition } from '../hooks/useGsapPageTransition';
import { useWindowFocus } from '../hooks/useWindowFocus';
import type { MetadataViewHandle } from '../components/MetadataView';

export function useUIStore() {
  useGsapButtonBounce();

  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const { containerRef: pageContentRef, navigate: transitionToView } = useGsapPageTransition(viewMode, setViewMode);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [autoLocateToken, setAutoLocateToken] = useState(0);
  const [pendingNavigation, setPendingNavigation] = useState<ViewMode | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const metadataViewRef = useRef<MetadataViewHandle>(null);
  const isWindowFocused = useWindowFocus();
  const floatingPanel = useFloatingPanel();
  const glassUI = useGlassUI();

  const markTrackSwitch = useCallback(() => {
    setAutoLocateToken(prev => prev + 1);
  }, []);

  const handleNavigate = useCallback((mode: ViewMode) => {
    if (viewMode === ViewMode.METADATA && mode !== ViewMode.METADATA && metadataViewRef.current?.hasUnsavedChanges) {
      setPendingNavigation(mode);
      return;
    }
    transitionToView(mode);
    setIsFocusMode(false);
  }, [viewMode, transitionToView]);

  return {
    viewMode,
    setViewMode,
    transitionToView,
    pageContentRef,
    isFocusMode,
    setIsFocusMode,
    autoLocateToken,
    markTrackSwitch,
    pendingNavigation,
    setPendingNavigation,
    headerHeight,
    setHeaderHeight,
    metadataViewRef,
    isWindowFocused,
    floatingPanel,
    glassUI,
    handleNavigate,
  };
}
