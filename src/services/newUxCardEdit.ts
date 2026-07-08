/**
 * New UI card edit service — stores local overrides for card entries
 * (custom cover, display name, visibility) and shell appearance settings
 * (background image, blur radius).
 *
 * Completely separate from the legacy playlistOverrides service.
 *
 * Storage: IndexedDB `settings` store.
 *   - key "new-ux-card-overrides" → JSON Record<entryId, CardOverride>
 *   - key "new-ux-bg-image"       → base64 data-URL string (or empty)
 *   - key "new-ux-bg-blur"        → JSON number (blur radius in px)
 */

import { indexedDBStorage } from './indexedDBStorage';
import { logger } from './logger';

// ── Types ────────────────────────────────────────────────────────────

export interface CardOverride {
  /** Custom cover image as base64 data-URL */
  coverUrl?: string;
  /** Custom display name */
  name?: string;
  /** Hidden from the card wall */
  hidden?: boolean;
}

export type CardOverrideMap = Record<string, CardOverride>;

// ── Storage keys ─────────────────────────────────────────────────────

const OVERRIDES_KEY = 'new-ux-card-overrides';
const BG_IMAGE_KEY = 'new-ux-bg-image';
const BG_BLUR_KEY = 'new-ux-bg-blur';

// ── In-memory cache ──────────────────────────────────────────────────

let overridesCache: CardOverrideMap | null = null;
let bgImageCache: string | null = null;
let bgBlurCache: number | null = null;

// ── Card overrides ───────────────────────────────────────────────────

export async function loadCardOverrides(): Promise<CardOverrideMap> {
  if (overridesCache) return overridesCache;
  try {
    const raw = await indexedDBStorage.getSetting(OVERRIDES_KEY);
    overridesCache = raw ? (JSON.parse(raw) as CardOverrideMap) : {};
  } catch (e) {
    logger.warn('[NewUxCardEdit] load overrides failed:', e);
    overridesCache = {};
  }
  return overridesCache;
}

async function persistOverrides(map: CardOverrideMap): Promise<void> {
  try {
    await indexedDBStorage.setSetting(OVERRIDES_KEY, JSON.stringify(map));
  } catch (e) {
    logger.error('[NewUxCardEdit] save overrides failed:', e);
  }
}

export function getCardOverride(entryId: string): CardOverride | undefined {
  return overridesCache?.[entryId];
}

export async function setCardOverride(
  entryId: string,
  patch: Partial<CardOverride>,
): Promise<CardOverrideMap> {
  const map = await loadCardOverrides();
  const existing = map[entryId] ?? {};
  const merged = { ...existing, ...patch };

  // Remove fields that are explicitly cleared (undefined)
  for (const k of Object.keys(merged) as (keyof CardOverride)[]) {
    if (merged[k] === undefined) delete merged[k];
  }

  // Remove the entry entirely if all fields are cleared
  if (!merged.coverUrl && !merged.name && !merged.hidden) {
    delete map[entryId];
  } else {
    map[entryId] = merged;
  }

  overridesCache = map;
  await persistOverrides(map);
  return { ...map };
}

// ── Background image ─────────────────────────────────────────────────

export async function loadBgImage(): Promise<string> {
  if (bgImageCache !== null) return bgImageCache;
  try {
    bgImageCache = (await indexedDBStorage.getSetting(BG_IMAGE_KEY)) ?? '';
  } catch (e) {
    logger.warn('[NewUxCardEdit] load bg image failed:', e);
    bgImageCache = '';
  }
  return bgImageCache;
}

export async function saveBgImage(dataUrl: string): Promise<void> {
  bgImageCache = dataUrl;
  try {
    if (dataUrl) {
      await indexedDBStorage.setSetting(BG_IMAGE_KEY, dataUrl);
    } else {
      await indexedDBStorage.deleteSetting(BG_IMAGE_KEY);
    }
  } catch (e) {
    logger.error('[NewUxCardEdit] save bg image failed:', e);
  }
}

// ── Background blur radius ───────────────────────────────────────────

export async function loadBgBlur(): Promise<number> {
  if (bgBlurCache !== null) return bgBlurCache;
  try {
    const raw = await indexedDBStorage.getSetting(BG_BLUR_KEY);
    bgBlurCache = raw ? JSON.parse(raw) : 80;
  } catch {
    bgBlurCache = 80;
  }
  return bgBlurCache ?? 80;
}

export async function saveBgBlur(radius: number): Promise<void> {
  bgBlurCache = radius;
  try {
    await indexedDBStorage.setSetting(BG_BLUR_KEY, JSON.stringify(radius));
  } catch (e) {
    logger.error('[NewUxCardEdit] save bg blur failed:', e);
  }
}
