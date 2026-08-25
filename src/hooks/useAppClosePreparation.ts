import { useEffect } from 'react';
import { getDesktopAPIAsync, isDesktop } from '../services/desktopAdapter';
import { requestLibraryFlush } from '../services/libraryFlushEvent';
import { logger } from '../services/logger';
import { requestPlaybackShutdown } from '../services/playbackShutdown';

export function useAppClosePreparation(): void {
  useEffect(() => {
    if (!isDesktop()) return;

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
