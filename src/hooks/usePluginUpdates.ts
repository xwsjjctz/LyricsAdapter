import { useEffect, useState } from 'react';
import { getDesktopAPI } from '@/services/desktopAdapter';
import type { PluginUpdateInfo } from '@/shared/pluginUpdate';

export function usePluginUpdates() {
  const [updates, setUpdates] = useState<PluginUpdateInfo[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const api = getDesktopAPI();
    let alive = true, revision = 0;
    const unsubscribe = api?.onPluginUpdatesChanged?.(value => { revision++; if (alive) setUpdates(value); });
    void api?.pluginUpdateList?.().then(value => { if (alive && revision === 0) setUpdates(value); })
      .catch(error => { if (alive) setError(String(error)); });
    return () => { alive = false; unsubscribe?.(); };
  }, []);
  return { updates, error, setUpdates };
}
