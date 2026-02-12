import { useCallback, useEffect, useState } from 'react';

interface WindowControls {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: boolean;
  canControl: boolean; // 是否在桌面环境（Electron）
}

export const useWindowControls = (): WindowControls => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [canControl, setCanControl] = useState(false);

  useEffect(() => {
    // 检测是否在桌面环境
    const isElectron = typeof window !== 'undefined' && !!(window as any).electron;

    setCanControl(isElectron);

    // 如果是 Electron，获取窗口状态
    if (isElectron && (window as any).electron?.isMaximized) {
      (window as any).electron.isMaximized().then(setIsMaximized).catch(() => {});
    }
  }, []);

  const minimize = useCallback(() => {
    if ((window as any).electron?.minimizeWindow) {
      (window as any).electron.minimizeWindow();
    }
  }, []);

  const maximize = useCallback(async () => {
    if ((window as any).electron?.maximizeWindow) {
      await (window as any).electron.maximizeWindow();
      // 更新状态
      const newState = await (window as any).electron.isMaximized();
      setIsMaximized(newState);
    }
  }, []);

  const close = useCallback(() => {
    if ((window as any).electron?.closeWindow) {
      (window as any).electron.closeWindow();
    }
  }, []);

  return {
    minimize,
    maximize,
    close,
    isMaximized,
    canControl
  };
};
