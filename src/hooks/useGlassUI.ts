import { useEffect, useState } from 'react';
import { settingsManager } from '../services/settingsManager';

/**
 * Tracks the "Frosted Glass UI" experimental setting.
 * Re-renders subscribers whenever the setting changes (e.g. toggled in Settings).
 * Returns the current boolean value.
 *
 * @deprecated Frosted Glass UI 已从实验性功能移除，暂时停用（恒为 false）。后续迭代或移除。
 */
export function useGlassUI(): boolean {
  const [glassUI, setGlassUI] = useState<boolean>(settingsManager.getGlassUI());

  useEffect(() => {
    const unsubscribe = settingsManager.subscribe(() => {
      setGlassUI(settingsManager.getGlassUI());
    });
    return unsubscribe;
  }, []);

  return glassUI;
}
