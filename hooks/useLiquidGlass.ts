import { useEffect, useState } from 'react';
import { settingsManager } from '../services/settingsManager';

/**
 * Tracks the "Liquid Glass" experimental setting (纯CSS液态玻璃).
 * Controls the liquid-glass surface treatment on the library toolbar
 * buttons and the Focus Mode player console. Re-renders subscribers
 * whenever the setting changes (e.g. toggled in Settings).
 *
 * @returns the current boolean value (defaults to true).
 */
export function useLiquidGlass(): boolean {
  const [liquidGlass, setLiquidGlass] = useState<boolean>(settingsManager.getLiquidGlass());

  useEffect(() => {
    const unsubscribe = settingsManager.subscribe(() => {
      setLiquidGlass(settingsManager.getLiquidGlass());
    });
    return unsubscribe;
  }, []);

  return liquidGlass;
}
