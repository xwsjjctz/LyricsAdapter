import { useCallback, useEffect, useState } from 'react';
import { getDesktopAPI } from '../services/desktopAdapter';
import { requestLibraryFlush } from '../services/libraryFlushEvent';
import { requestPlaybackShutdown } from '../services/playbackShutdown';

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
    const api = getDesktopAPI();
    setCanControl(api !== null);
    if (!api) return;

    api.isMaximized?.().then(setIsMaximized).catch(() => {});
    api.isFullScreen?.().then(setIsFullScreen).catch(() => {});

    const unsub = api.onFullScreenChange?.((isFs: boolean) => setIsFullScreen(isFs));

    return () => { unsub?.(); };
  }, []);

  const minimize = useCallback(() => {
    void getDesktopAPI()?.minimizeWindow?.();
  }, []);

  const maximize = useCallback(async () => {
    const api = getDesktopAPI();
    if (!api?.maximizeWindow) return;
    await api.maximizeWindow();
    const newState = await api.isMaximized?.();
    if (newState !== undefined) setIsMaximized(newState);
  }, []);

  const close = useCallback(() => {
    const api = getDesktopAPI();
    if (!api?.closeWindow) return;
    void requestLibraryFlush().then(async (saved) => {
      if (saved) {
        await requestPlaybackShutdown();
        await api.closeWindow?.(true);
      }
    });
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
