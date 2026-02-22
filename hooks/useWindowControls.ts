import { useCallback, useEffect, useState } from 'react';
import type { DesktopAPI } from '../services/desktopAdapter';

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
    const isElectron = typeof window !== 'undefined' && !!(window as Window & { electron?: DesktopAPI }).electron;
    setCanControl(isElectron);

    // 如果是 Electron，获取窗口状态
    if (isElectron && (window as Window & { electron?: DesktopAPI }).electron?.isMaximized) {
      const result = (window as Window & { electron?: DesktopAPI }).electron!.isMaximized!();
      // isMaximized 返回的是 Promise<boolean>
      (result as Promise<boolean>).then(setIsMaximized).catch(() => {});
    }
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
    canControl
  };
};
