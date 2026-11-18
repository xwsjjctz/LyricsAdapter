/**
 * Local tracks whose lyrics have already been looked up. Each track is matched
 * once: when the search found nothing there is nothing new to find, and when
 * the user removed what it found the lyrics must not come back on their own.
 * Stored as a JSON array of track ids, oldest first.
 */
import { appStorage } from './appStorage';
import { logger } from '../logger';

const STORAGE_KEY = 'lyrics-match-tried';
/** Beyond this the oldest ids are forgotten; such a track is simply looked up once more. */
const MAX_REMEMBERED = 10_000;
/** A large import records an id every second or so; one write then covers many. */
const SAVE_DELAY_MS = 5_000;

let tried: Set<string> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Set<string> {
  if (tried) return tried;
  tried = new Set();
  try {
    const parsed: unknown = JSON.parse(appStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      for (const id of parsed) {
        if (typeof id === 'string') tried.add(id);
      }
    }
  } catch (error) {
    logger.warn('[LyricsMatch] Ignoring an unreadable list of matched tracks:', error);
  }
  return tried;
}

export function wasLyricsMatchTried(trackId: string): boolean {
  return load().has(trackId);
}

export function rememberLyricsMatchTried(trackId: string): void {
  const ids = load();
  ids.delete(trackId);
  ids.add(trackId);
  for (const oldest of ids) {
    if (ids.size <= MAX_REMEMBERED) break;
    ids.delete(oldest);
  }
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    void flushLyricsMatchTried();
  }, SAVE_DELAY_MS);
}

/** Writes the list now; called on its own after a short delay. */
export async function flushLyricsMatchTried(): Promise<void> {
  if (!tried) return;
  try {
    await appStorage.setItem(STORAGE_KEY, JSON.stringify([...tried]));
  } catch (error) {
    logger.warn('[LyricsMatch] Could not save the list of matched tracks:', error);
  }
}

/** Test seam: forget the in-memory list so the next call reads storage again. */
export function resetLyricsMatchTriedForTests(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  tried = null;
}
