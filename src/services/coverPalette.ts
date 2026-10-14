/**
 * Glow colours sampled from a cover: the few most prominent hues, lifted to
 * a luminous saturation and lightness so they read as light, not paint.
 *
 * Covers are drawn tiny on a canvas, which needs CORS-readable pixels:
 * `cover://` allows the app origin, and remote covers that refuse CORS
 * resolve to null so the caller falls back to the theme accent.
 */
import { logger } from './logger';

export type CoverPalette = readonly string[];

const SAMPLE_SIZE = 24;
const HUE_BUCKETS = 12;
const PALETTE_SIZE = 4;
/** Pixels greyer than this carry no usable hue. */
const MIN_SATURATION = 0.18;
const MIN_VALUE = 0.12;
/** A bucket needs this share of the strongest one to become a palette colour. */
const MIN_BUCKET_SHARE = 0.12;
const MAX_CACHED = 64;

const cache = new Map<string, Promise<CoverPalette | null>>();

interface HueBucket {
  weight: number;
  /** Weighted sum of unit hue vectors, so red at 359° and 1° average correctly. */
  x: number;
  y: number;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return [0, 0, max];
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [(hue * 60 + 360) % 360, delta / max, max];
}

function glowColor(hue: number, shift = 0): string {
  return `hsl(${Math.round((hue + shift + 360) % 360)} 88% 64%)`;
}

/** Ranks hue buckets by saturated, bright pixel weight. Exported for tests. */
export function paletteFromPixels(data: Uint8ClampedArray): CoverPalette | null {
  const buckets: HueBucket[] = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, x: 0, y: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const [hue, saturation, value] = rgbToHsv(data[i]! / 255, data[i + 1]! / 255, data[i + 2]! / 255);
    if (saturation < MIN_SATURATION || value < MIN_VALUE) continue;
    const weight = saturation * Math.sqrt(value);
    const bucket = buckets[Math.floor(hue / (360 / HUE_BUCKETS)) % HUE_BUCKETS]!;
    const radians = (hue * Math.PI) / 180;
    bucket.weight += weight;
    bucket.x += Math.cos(radians) * weight;
    bucket.y += Math.sin(radians) * weight;
  }

  const ranked = buckets.filter(bucket => bucket.weight > 0).sort((a, b) => b.weight - a.weight);
  const strongest = ranked[0];
  if (!strongest) return null;
  const hues = ranked
    .filter(bucket => bucket.weight >= strongest.weight * MIN_BUCKET_SHARE)
    .slice(0, PALETTE_SIZE)
    .map(bucket => (Math.atan2(bucket.y, bucket.x) * 180) / Math.PI);

  // Single-hue covers still get movement: neighbouring hues around the main one.
  const shifts = [0, 28, -24, 52];
  const colors = hues.map(hue => glowColor(hue));
  for (let i = colors.length; i < PALETTE_SIZE; i += 1) {
    colors.push(glowColor(hues[i % hues.length]!, shifts[i]));
  }
  return colors;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`cover failed to load: ${url}`));
    image.src = url;
  });
}

async function samplePalette(url: string): Promise<CoverPalette | null> {
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return paletteFromPixels(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
  } catch (error) {
    logger.debug('[CoverPalette] using theme colours:', error);
    return null;
  }
}

/** Palette for a cover URL, cached per URL; null means use the theme accent. */
export function getCoverPalette(url: string): Promise<CoverPalette | null> {
  const cached = cache.get(url);
  if (cached) {
    // Refresh recency so the most used covers stay cached.
    cache.delete(url);
    cache.set(url, cached);
    return cached;
  }
  const pending = samplePalette(url);
  cache.set(url, pending);
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}
