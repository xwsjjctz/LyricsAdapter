import path from 'node:path';
import { app, net } from 'electron';
import { logger } from '../logger';
import { AmllLyricsDb } from '../services/lyrics/amllLyricsDb';
import { handleIpc } from './ipcMainTyped';
import { fail, ok, parsePayload } from './typedResult';
import { typedIpcSchemas } from './typedSchemas';

const COMMUNITY_LYRICS_DIR = 'community-lyrics';

export function registerLyricsHandlers(): void {
  let amll: AmllLyricsDb | null = null;

  handleIpc('ipc:lyrics:matchCommunity', async (_event, payload: unknown) => {
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
