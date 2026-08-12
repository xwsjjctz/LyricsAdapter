import { ipcMain } from 'electron';
import { logger } from '../logger';
import { persistenceRepository } from '../services/persistenceRepository';
import { errorMessage, fail, ok } from './typedResult';
import { persistenceBootstrapSchema } from './typedSchemas';

/** Register the typed read-only bootstrap facade after store migrations run. */
export function registerPersistenceHandlers(): void {
  ipcMain.handle('ipc:persistence:loadBootstrap', async () => {
    try {
      const bootstrap = await persistenceRepository.loadBootstrap();
      const parsed = persistenceBootstrapSchema.safeParse(bootstrap);
      return parsed.success ? ok(bootstrap) : fail(parsed.error.message);
    } catch (error) {
      // The repository normally converts per-source failures to StoreRead. This
      // outer result is reserved for an unexpected facade-level failure.
      return fail(errorMessage(error));
    }
  });

  logger.info('[PersistenceHandlers] Registered read-only bootstrap channel');
}
