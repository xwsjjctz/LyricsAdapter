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
const BG_IMAGE_MAX_DIMENSION = 2048;

// ── In-memory cache ──────────────────────────────────────────────────

let overridesCache: CardOverrideMap | null = null;
let bgImageCache: string | null = null;
let bgBlurCache: number | null = null;
let bgImageRevision = 0;

export function constrainImageDimensions(
  width: number,
  height: number,
  maxDimension = BG_IMAGE_MAX_DIMENSION,
): { width: number; height: number } {
  const largestDimension = Math.max(width, height);
  if (largestDimension <= maxDimension) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxDimension / largestDimension;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decode a custom shell background once and persist a display-sized WebP.
 * Keeping an original 8K data URL makes Chromium retain a decoded surface well
 * over 100 MiB before blur/filter intermediates are counted.
 */
export async function optimizeBgImage(source: Blob | string): Promise<string> {
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  const sourceUrl = typeof source === 'string' ? source : objectUrl!;
  const image = new Image();
  image.decoding = 'async';
  let canvas: HTMLCanvasElement | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => {
        image.onload = null;
        image.onerror = null;
        resolve();
      };
      image.onerror = () => {
        image.onload = null;
        image.onerror = null;
        reject(new Error('Unable to decode background image'));
      };
      image.src = sourceUrl;
    });

    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    if (!naturalWidth || !naturalHeight) throw new Error('Background image has invalid dimensions');

    const target = constrainImageDimensions(naturalWidth, naturalHeight);
    if (
      typeof source === 'string'
      && target.width === naturalWidth
      && target.height === naturalHeight
    ) {
      return source;
    }

    canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create background image canvas');
    context.drawImage(image, 0, 0, target.width, target.height);
    return canvas.toDataURL('image/webp', 0.86);
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

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
  const revision = bgImageRevision;
  try {
    const stored = (await indexedDBStorage.getSetting(BG_IMAGE_KEY)) ?? '';
    if (revision !== bgImageRevision) return bgImageCache ?? '';
    bgImageCache = stored;
  } catch (e) {
    logger.warn('[NewUxCardEdit] load bg image failed:', e);
    bgImageCache = '';
  }

  if (bgImageCache) {
    const source = bgImageCache;
    try {
      const optimized = await optimizeBgImage(source);
      if (
        optimized !== source
        && revision === bgImageRevision
        && bgImageCache === source
      ) {
        bgImageCache = optimized;
        await indexedDBStorage.setSetting(BG_IMAGE_KEY, optimized);
      }
    } catch (e) {
      // Retain the existing setting if a legacy or unsupported image cannot be
      // migrated. A future replacement upload will still be constrained.
      logger.warn('[NewUxCardEdit] optimize bg image failed:', e);
    }
  }
  return bgImageCache;
}

export async function saveBgImage(dataUrl: string): Promise<void> {
  bgImageRevision += 1;
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
