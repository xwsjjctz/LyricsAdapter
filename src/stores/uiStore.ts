import { useCallback, useState } from 'react';
import { ViewMode } from '../types';
import type { SettingsSectionId } from '../components/settings/SettingsView';
import { useFloatingPanel } from '../hooks/useFloatingPanel';
import { useGsapButtonBounce } from '../hooks/useGsapButtonBounce';
import { useGsapPageTransition } from '../hooks/useGsapPageTransition';
import { useWindowFocus } from '../hooks/useWindowFocus';

export function useUIStore() {
  useGsapButtonBounce();

  // The poster wall is the home page; other pages open from the command palette.
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.WALL);
  const [isFocusMode, setIsFocusMode] = useState(false);
  // Settings float over the current wall instead of replacing it.
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
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
    isWindowFocused,
    floatingPanel,
    handleNavigate,
    settingsSection,
    openSettings,
    closeSettings,
  };
}
