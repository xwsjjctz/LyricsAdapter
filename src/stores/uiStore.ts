import { useCallback, useState } from 'react';
import { ViewMode } from '../types';
import { useFloatingPanel } from '../hooks/useFloatingPanel';
import { useGsapButtonBounce } from '../hooks/useGsapButtonBounce';
import { useGsapPageTransition } from '../hooks/useGsapPageTransition';
import { useWindowFocus } from '../hooks/useWindowFocus';

export function useUIStore() {
  useGsapButtonBounce();

  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.PLAYER);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [autoLocateToken, setAutoLocateToken] = useState(0);
  const isWindowFocused = useWindowFocus();
  const floatingPanel = useFloatingPanel();
  const { containerRef: pageContentRef, navigate: transitionToView } = useGsapPageTransition(
    viewMode,
    setViewMode,
  );

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
