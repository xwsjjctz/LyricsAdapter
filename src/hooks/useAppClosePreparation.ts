import { useEffect } from 'react';
import { getDesktopAPIAsync } from '../services/desktopAdapter';
import { requestLibraryFlush } from '../services/libraryFlushEvent';
import { logger } from '../services/logger';
import { requestPlaybackShutdown } from '../services/playbackShutdown';

export function useAppClosePreparation(): void {
  useEffect(() => {
    // Browser mode has no native close handshake; its unload trigger lives in
    // the runtime state writer.
    let mounted = true;
    let removeWindowCloseListener: (() => void) | undefined;

    void getDesktopAPIAsync().then(api => {
      if (!mounted) return;
      removeWindowCloseListener = api?.onBeforeWindowClose?.(async () => {
        const [saved] = await Promise.all([
          requestLibraryFlush(),
          requestPlaybackShutdown(),
        ]);
        return saved;
      });
    }).catch(error => {
      logger.warn('[AppClose] Failed to register close preparation listener:', error);
    });

    return () => {
      mounted = false;
      removeWindowCloseListener?.();
    };
  }, []);
}
