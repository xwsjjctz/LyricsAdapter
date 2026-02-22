/**
 * Application-wide constants
 *
 * This file centralizes all hardcoded values that were previously scattered
 * throughout the codebase. Import values from here instead of hardcoding.
 */

/**
 * Audio preloading configuration
 */
export const PRELOAD = {
  /** Maximum file size for preloading in bytes (50MB) */
  MAX_SIZE_BYTES: 50 * 1024 * 1024,

  /** Delay before preloading adjacent tracks in milliseconds */
  DELAY_MS: 500,

  /** Number of adjacent tracks to preload (before and after) */
  ADJACENT_COUNT: 1,
} as const;

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
  DB_VERSION: 1,
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
 * File format constants
 */
export const FORMATS = {
  /** Supported audio file extensions */
  AUDIO_EXTENSIONS: ['.flac', '.mp3', '.m4a', '.wav'],

  /** MIME types for audio files */
  AUDIO_MIME_TYPES: [
    'audio/flac',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/wave',
  ],

  /** Cover art MIME types */
  IMAGE_MIME_TYPES: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ],
} as const;

/**
 * Playback configuration
 */
export const PLAYBACK = {
  /** Time in seconds before track end to trigger next track preload */
  PRELOAD_THRESHOLD: 30,

  /** Maximum restore time offset from end in seconds */
  MAX_RESTORE_OFFSET: 0.5,
} as const;

/**
 * API configuration
 */
export const API = {
  /** Request timeout in milliseconds */
  REQUEST_TIMEOUT: 10000,

  /** Maximum retry attempts for failed requests */
  MAX_RETRIES: 3,

  /** Delay between retries in milliseconds */
  RETRY_DELAY: 1000,
} as const;

/**
 * Application metadata
 */
export const APP = {
  /** Application name */
  NAME: 'LyricsAdapter',

  /** Application version */
  VERSION: '1.0.0',

  /** Electron app ID */
  APP_ID: 'com.lyricsadapter.app',
} as const;
