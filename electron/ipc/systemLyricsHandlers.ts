import { ipcMain } from 'electron';
import type { SystemLyricsState } from '../../src/types/systemLyrics';
import { logger } from '../logger';
import { typedIpcSchemas } from './typedSchemas';
import { fail, ok, parsePayload } from './typedResult';

export interface SystemLyricsStateTarget {
  update(state: SystemLyricsState): void | Promise<void>;
}

export function registerSystemLyricsHandlers(target: SystemLyricsStateTarget): void {
  ipcMain.handle('ipc:systemLyrics:update', async (_event, payload: unknown) => {
    const parsed = parsePayload(typedIpcSchemas.systemLyricsState, payload);
    if (!parsed.ok) return parsed;

    try {
      await target.update(parsed.data);
      return ok(undefined);
    } catch (error) {
      logger.error('[SystemLyrics] Failed to update system surface:', error);
      return fail(error instanceof Error ? error.message : String(error));
    }
  });
}
