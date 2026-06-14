import { useEffect, useState } from 'react';
import { settingsManager } from '../services/settingsManager';

/**
 * Tracks the floating-panel setting and re-renders when it changes
 * (other components can toggle it via settingsManager).
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
