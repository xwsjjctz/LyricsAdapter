/**
 * Application-wide constants
 *
 * This file centralizes all hardcoded values that were previously scattered
 * throughout the codebase. Import values from here instead of hardcoding.
 */

/**
 * Storage limits and configuration
 */
export const STORAGE = {
  /** Maximum cover art size for IndexedDB storage in bytes (10MB) */
  MAX_COVER_SIZE_BYTES: 10 * 1024 * 1024,

  /** Maximum number of metadata cache entries for Electron */
  METADATA_CACHE_SIZE: 50,

  /** IndexedDB database name */
  DB_NAME: 'lyrics-adapter-db',

  /** IndexedDB database version */
  DB_VERSION: 4,
} as const;

/**
 * UI constants
 */
export const UI = {
  /** Library view item height in pixels */
  LIBRARY_ITEM_HEIGHT: 80,

  /** Number of items to buffer in virtualized list */
  LIST_BUFFER_SIZE: 5,

  /** Default volume level (0-1) */
  DEFAULT_VOLUME: 0.5,

  /** Seek step when clicking progress bar (0-1) */
  SEEK_STEP: 0.05,
} as const;

/**
 * Application metadata
 */
export const APP = {
  /** Application name */
  NAME: 'LyricsAdapter',

  /** Application version */
  VERSION: '0.1.0',

  /** Electron app ID */
  APP_ID: 'com.lyricsadapter.app',
} as const;
