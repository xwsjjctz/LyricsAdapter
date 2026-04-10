import { ipcMain, app } from 'electron';
import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { logger } from './logger';

let cleanupProcess: ChildProcess | null = null;

export function registerCleanupHandlers(): void {
  ipcMain.handle('run-startup-cleanup', async (_event, activeTrackIds: string[]) => {
    if (cleanupProcess) {
      logger.debug('[Cleanup] Cleanup already running, skipping');
      return { success: true, message: 'already_running' };
    }

    const userDataPath = app.getPath('userData');
    const appPath = app.getAppPath();
    const cleanupScriptPath = path.join(appPath, 'dist-electron', 'cleanup.js');

    logger.info('[Cleanup] Starting cleanup process...');

    return new Promise((resolve) => {
      try {
        cleanupProcess = fork(cleanupScriptPath, [userDataPath, JSON.stringify(activeTrackIds)], {
          detached: true,
          stdio: 'ignore'
        });

        cleanupProcess.on('error', (err) => {
          logger.error('[Cleanup] Process error:', err);
          cleanupProcess = null;
          resolve({ success: false, error: err.message });
        });

        cleanupProcess.on('exit', (code) => {
          logger.info(`[Cleanup] Process exited with code ${code}`);
          cleanupProcess = null;
          resolve({ success: true, exitCode: code });
        });

        cleanupProcess.unref();
        logger.info('[Cleanup] Cleanup process spawned');
      } catch (err) {
        logger.error('[Cleanup] Failed to spawn cleanup process:', err);
        cleanupProcess = null;
        resolve({ success: false, error: (err as Error).message });
      }
    });
  });
}
