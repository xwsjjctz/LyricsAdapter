/**
 * Data Validator Service
 * Provides validation functions for data stored in IndexedDB
 * Prevents injection attacks and data corruption
 */

import { logger } from './logger';

// ========== Type Definitions ==========

export interface ValidatedMetadata {
  title: string;
  artist: string;
  album: string;
  duration: number;
  lyrics: string;
  syncedLyrics?: { time: number; text: string }[];
  fileName: string;
  fileSize: number;
  lastModified: number;
}

// ========== Validation Constants ==========

const MAX_STRING_LENGTH = 10000;
const MAX_TITLE_LENGTH = 500;
const MAX_ARTIST_LENGTH = 500;
const MAX_ALBUM_LENGTH = 500;
const MAX_FILENAME_LENGTH = 1000;
const MAX_LYRICS_LENGTH = 100000;
const MAX_SYNCED_LYRICS_COUNT = 10000;
const MAX_DURATION = 24 * 60 * 60; // 24 hours in seconds
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const MIN_TIMESTAMP = 0;
const MAX_TIMESTAMP = 9999999999999;

// ========== Sanitization Functions ==========

/**
 * Sanitize string to prevent XSS attacks
 * - Removes null bytes
 * - Removes control characters (except newlines and tabs for lyrics)
 * - Limits length
 */
function sanitizeString(input: unknown, maxLength: number, allowNewlines = false): string {
  if (typeof input !== 'string') {
    return '';
  }

  let str = input;

  // Remove null bytes
  str = str.replace(/\0/g, '');

  // Remove control characters based on context
  if (allowNewlines) {
    // For lyrics, keep newlines and tabs
    str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } else {
    // For other fields, remove most control characters
    str = str.replace(/[\x00-\x1F\x7F]/g, '');
  }

  // Trim whitespace
  str = str.trim();

  // Limit length
  if (str.length > maxLength) {
    str = str.substring(0, maxLength);
  }

  return str;
}

/**
 * Sanitize number to ensure it's within valid range
 */
function sanitizeNumber(input: unknown, min: number, max: number, defaultValue: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, input));
}

/**
 * Sanitize synced lyrics array
 */
function sanitizeSyncedLyrics(input: unknown): { time: number; text: string }[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  if (input.length > MAX_SYNCED_LYRICS_COUNT) {
    return undefined;
  }

  const sanitized: { time: number; text: string }[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const obj = item as Record<string, unknown>;
    const time = sanitizeNumber(
      obj.time,
      0,
      MAX_DURATION,
      0
    );
    const text = sanitizeString(obj.text, MAX_STRING_LENGTH, true);

    if (text) {
      sanitized.push({ time, text });
    }
  }

  return sanitized.length > 0 ? sanitized : undefined;
}

// ========== Metadata Validation ==========

/**
 * Validate metadata object
 * Returns sanitized metadata or null if invalid
 */
export function validateMetadata(data: unknown): ValidatedMetadata | null {
  if (!data || typeof data !== 'object') {
    logger.warn('[DataValidator] Invalid metadata: not an object');
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Validate required fields - use fallback if missing
  let title = sanitizeString(obj.title, MAX_TITLE_LENGTH);
  let artist = sanitizeString(obj.artist, MAX_ARTIST_LENGTH);
  let album = sanitizeString(obj.album, MAX_ALBUM_LENGTH);
  const lyrics = sanitizeString(obj.lyrics || '', MAX_LYRICS_LENGTH, true);
  let fileName = sanitizeString(obj.fileName, MAX_FILENAME_LENGTH);

  // Use fallback values if missing (instead of rejecting)
  if (!title) {
    title = fileName?.replace(/\.[^/.]+$/, '') || 'Unknown Title';
  }

  if (!fileName) {
    fileName = 'unknown file';
  }

  // Validate numeric fields
  const duration = sanitizeNumber(obj.duration, 0, MAX_DURATION, 0);
  const fileSize = sanitizeNumber(obj.fileSize, 0, MAX_FILE_SIZE, 0);
  const lastModified = sanitizeNumber(obj.lastModified, MIN_TIMESTAMP, MAX_TIMESTAMP, Date.now());

  // Validate optional syncedLyrics
  const syncedLyrics = sanitizeSyncedLyrics(obj.syncedLyrics);

  return {
    title,
    artist,
    album,
    duration,
    lyrics,
    syncedLyrics,
    fileName,
    fileSize,
    lastModified,
  };
}

/**
 * Validate metadata map (for bulk loading)
 */
export function validateMetadataMap(data: Record<string, unknown>): Record<string, ValidatedMetadata> {
  const result: Record<string, ValidatedMetadata> = {};

  for (const [key, value] of Object.entries(data)) {
    // Validate songId
    if (typeof key !== 'string' || key.length === 0 || key.length > 1000) {
      logger.warn(`[DataValidator] Invalid songId: ${key}`);
      continue;
    }

    const validated = validateMetadata(value);
    if (validated) {
      result[key] = validated;
    } else {
      logger.warn(`[DataValidator] Skipping invalid metadata for song: ${key}`);
    }
  }

  return result;
}

/**
 * Validate songId
 */
export function validateSongId(songId: unknown): string | null {
  if (typeof songId !== 'string') {
    return null;
  }

  // Check length
  if (songId.length === 0 || songId.length > 1000) {
    return null;
  }

  // Check for null bytes
  if (songId.includes('\0')) {
    return null;
  }

  return songId;
}

// ========== Blob Validation ==========

/**
 * Validate if input is a valid Blob
 */
export function isValidBlob(data: unknown): data is Blob {
  return data instanceof Blob;
}

/**
 * Validate blob size and type
 */
export function validateBlob(data: unknown, maxSize: number = 10 * 1024 * 1024): Blob | null {
  if (!isValidBlob(data)) {
    return null;
  }

  const blob = data as Blob;

  // Check size
  if (blob.size > maxSize) {
    logger.warn(`[DataValidator] Blob too large: ${blob.size} bytes`);
    return null;
  }

  // Check size is non-negative
  if (blob.size < 0) {
    logger.warn('[DataValidator] Invalid blob size');
    return null;
  }

  return blob;
}

// ========== Error Reporting ==========

export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate and throw error if invalid
 */
export function validateMetadataOrThrow(data: unknown): ValidatedMetadata {
  const validated = validateMetadata(data);
  if (!validated) {
    throw new ValidationError('Invalid metadata structure');
  }
  return validated;
}
