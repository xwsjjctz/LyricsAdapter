import { useCallback, useEffect, useState } from 'react';
import type { DesktopAPI } from '../services/desktopAdapter';

interface WindowControls {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: boolean;
  isFullScreen: boolean;
  canControl: boolean;
}

export const useWindowControls = (): WindowControls => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [canControl, setCanControl] = useState(false);

  useEffect(() => {
    const isElectron = typeof window !== 'undefined' && !!(window as Window & { electron?: DesktopAPI }).electron;
    setCanControl(isElectron);
    if (!isElectron) return;

    const api = (window as Window & { electron?: DesktopAPI }).electron!;

    api.isMaximized?.().then(setIsMaximized).catch(() => {});
    api.isFullScreen?.().then(setIsFullScreen).catch(() => {});

    const unsub = api.onFullScreenChange?.((isFs: boolean) => setIsFullScreen(isFs));

    return () => { unsub?.(); };
  }, []);

  const minimize = useCallback(() => {
    if ((window as Window & { electron?: DesktopAPI }).electron?.minimizeWindow) {
      (window as Window & { electron?: DesktopAPI }).electron!.minimizeWindow!();
    }
  }, []);

  const maximize = useCallback(async () => {
    if ((window as Window & { electron?: DesktopAPI }).electron?.maximizeWindow) {
      await (window as Window & { electron?: DesktopAPI }).electron!.maximizeWindow!();
      // 更新状态
      const newState = await (window as Window & { electron?: DesktopAPI }).electron!.isMaximized!();
      setIsMaximized(newState);
    }
  }, []);

  const close = useCallback(() => {
    if ((window as Window & { electron?: DesktopAPI }).electron?.closeWindow) {
      (window as Window & { electron?: DesktopAPI }).electron!.closeWindow!();
    }
  }, []);

  return {
    minimize,
    maximize,
    close,
    isMaximized,
    isFullScreen,
    canControl
  };
};
