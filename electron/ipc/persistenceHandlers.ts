import { ipcMain } from 'electron';
import { logger } from '../logger';
import { persistenceRepository } from '../services/persistenceRepository';
import { persistenceCommitService } from '../services/persistenceCommitService';
import { errorMessage, fail, ok, parsePayload } from './typedResult';
import { persistenceBootstrapSchema, persistenceCloseCommitSchema } from './typedSchemas';

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

  ipcMain.handle('ipc:persistence:commitClose', async (_event, payload: unknown) => {
    const parsed = parsePayload(persistenceCloseCommitSchema, payload);
    if (!parsed.ok) return parsed;

    try {
      // Partial physical-store failures are normal use-case results and remain
      // inside an outer ok envelope so no per-source diagnostics are lost.
      return ok(await persistenceCommitService.commitClose(parsed.data));
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  logger.info('[PersistenceHandlers] Registered bootstrap + close commit channels');
}
