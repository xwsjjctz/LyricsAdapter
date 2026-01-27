import { useCallback, useEffect, useState } from 'react';

interface WindowControls {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: boolean;
  canControl: boolean; // 是否在桌面环境（Electron/Tauri）
}

export const useWindowControls = (): WindowControls => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [canControl, setCanControl] = useState(false);
  const [tauriWindow, setTauriWindow] = useState<any>(null);

  useEffect(() => {
    // 检测是否在桌面环境
    const isElectron = typeof window !== 'undefined' &&
                       ((window as any).electron ||
                        (window as any).__TAURI_INTERNALS__?.platform === 'electron');

    const isTauri = typeof window !== 'undefined' &&
                    ((window as any).__TAURI_INTERNALS__ ||
                     navigator.userAgent.includes('Tauri'));

    setCanControl(isElectron || isTauri);

    // 如果是 Electron，获取窗口状态
    if (isElectron && (window as any).electron?.isMaximized) {
      (window as any).electron.isMaximized().then(setIsMaximized).catch(() => {});
    }

    // 如果是 Tauri，动态导入并初始化窗口 API
    if (isTauri) {
      const checkTauriAndLoad = async () => {
        try {
          // 只有在确认是 Tauri 环境时才导入
          if (typeof window !== 'undefined' && (window as any).__TAURI__) {
            // 使用 Function 构造器来避免 Vite 分析这个 import
            const loadTauriWindow = new Function('return import("@tauri-apps/api/window")');
            const { getCurrentWindow } = await loadTauriWindow();
            const win = getCurrentWindow();
            setTauriWindow(win);
            // 获取当前窗口状态
            win.isMaximized().then(setIsMaximized).catch(() => {});
          }
        } catch (error) {
          console.warn('Failed to load Tauri window API:', error);
        }
      };

      checkTauriAndLoad();
    }
  }, []);

  const minimize = useCallback(() => {
    if ((window as any).electron?.minimizeWindow) {
      (window as any).electron.minimizeWindow();
    } else if (tauriWindow) {
      tauriWindow.minimize();
    }
  }, [tauriWindow]);

  const maximize = useCallback(async () => {
    if ((window as any).electron?.maximizeWindow) {
      await (window as any).electron.maximizeWindow();
      // 更新状态
      const newState = await (window as any).electron.isMaximized();
      setIsMaximized(newState);
    } else if (tauriWindow) {
      tauriWindow.toggleMaximize().then(() => {
        tauriWindow.isMaximized().then(setIsMaximized);
      });
    }
  }, [tauriWindow]);

  const close = useCallback(() => {
    if ((window as any).electron?.closeWindow) {
      (window as any).electron.closeWindow();
    } else if (tauriWindow) {
      tauriWindow.close();
    }
  }, [tauriWindow]);

  return {
    minimize,
    maximize,
    close,
    isMaximized,
    canControl
  };
};
