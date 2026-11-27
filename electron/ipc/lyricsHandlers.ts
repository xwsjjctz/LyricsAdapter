import path from 'node:path';
import { app, net } from 'electron';
import { logger } from '../logger';
import { AmllLyricsDb } from '../services/lyrics/amllLyricsDb';
import { handleIpc } from './ipcMainTyped';
import { fail, ok, parsePayload } from './typedResult';
import { typedIpcSchemas } from './typedSchemas';

const COMMUNITY_LYRICS_DIR = 'community-lyrics';

/**
 * End-to-end runs launch the real app with NODE_ENV=test. They must stay
 * deterministic, so the app does not go online on its own there.
 */
function lookupAllowed(): boolean {
  return process.env['NODE_ENV'] !== 'test';
}

export function registerLyricsHandlers(): void {
  let amll: AmllLyricsDb | null = null;

  handleIpc('ipc:lyrics:lookupAllowed', async () => ok(lookupAllowed()));

  handleIpc('ipc:lyrics:matchCommunity', async (_event, payload: unknown) => {
    if (!lookupAllowed()) return fail('Lyrics lookup is switched off in this run');
    const parsed = parsePayload(typedIpcSchemas.lyricsMatchQuery, payload);
    if (!parsed.ok) return parsed;
    try {
      amll ??= new AmllLyricsDb({
        directory: path.join(app.getPath('userData'), COMMUNITY_LYRICS_DIR),
        fetcher: (url, init) => net.fetch(url, init),
      });
      return ok(await amll.match(parsed.data));
    } catch (error) {
      logger.warn('[Lyrics] Community lyrics lookup failed:', error);
      return fail((error as Error).message);
    }
  });
}
