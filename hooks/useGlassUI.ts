import { useEffect, useState } from 'react';
import { settingsManager } from '../services/settingsManager';

/**
 * Tracks the "Frosted Glass UI" experimental setting.
 * Re-renders subscribers whenever the setting changes (e.g. toggled in Settings).
 * Returns the current boolean value.
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
