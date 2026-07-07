import { useEffect, useState } from 'react';
import { settingsManager } from '../../services/settingsManager';

export function useNewUxEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => settingsManager.getNewUxEnabled());

  useEffect(() => {
    const unsubscribe = settingsManager.subscribe(() => {
      setEnabled(settingsManager.getNewUxEnabled());
    });
    return unsubscribe;
  }, []);

  return enabled;
}
