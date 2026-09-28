import { useEffect, useState } from 'react';
import { settingsManager } from '../../../services/settingsManager';

/**
 * Reads one setting and re-renders when settings change. `read` must be
 * stable (a module-level function), or the subscription is recreated.
 */
export function useSettingValue<T>(read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    let active = true;
    void settingsManager.ensureLoaded().then(() => { if (active) setValue(read()); });
    const unsubscribe = settingsManager.subscribe(() => setValue(read()));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [read]);
  return value;
}
