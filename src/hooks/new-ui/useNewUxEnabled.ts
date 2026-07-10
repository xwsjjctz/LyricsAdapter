import { useEffect, useState } from 'react';
import { settingsManager } from '../../services/settingsManager';

export function useNewUxEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => settingsManager.getNewUxEnabled());

  useEffect(() => {
    let isMounted = true;
    void settingsManager.ensureLoaded().then(() => {
      if (isMounted) {
        setEnabled(settingsManager.getNewUxEnabled());
      }
    });

    const unsubscribe = settingsManager.subscribe(() => {
      setEnabled(settingsManager.getNewUxEnabled());
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return enabled;
}
