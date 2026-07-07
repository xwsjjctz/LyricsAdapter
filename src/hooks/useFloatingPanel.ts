import { useEffect, useState } from 'react';
import { settingsManager } from '../services/settingsManager';

/**
 * Tracks the floating-panel setting and re-renders when it changes
 * (other components can toggle it via settingsManager).
 *
 * @deprecated Floating Panel 已从实验性功能移除，暂时停用（恒为 false）。后续迭代或移除。
 */
export function useFloatingPanel(): boolean {
  const [floatingPanel, setFloatingPanel] = useState(() => settingsManager.getFloatingPanel());

  useEffect(() => {
    const unsubscribe = settingsManager.subscribe(() => {
      setFloatingPanel(settingsManager.getFloatingPanel());
    });
    return unsubscribe;
  }, []);

  return floatingPanel;
}
