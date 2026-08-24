/**
 * Persistence keys that must never be mirrored to renderer localStorage in the
 * desktop app. They remain available in AppStorage's in-memory cache while the
 * main process encrypts their durable representation with safeStorage.
 */
const SENSITIVE_SETTING_KEYS = new Set([
  'webdav-config',
  'qq_music_cookie',
  'netease_cookie',
]);

/** Replaceable runtime caches that belong in the application data directory. */
const REPLACEABLE_CACHE_SETTING_KEYS = new Set([
  'webdav-cdn-cache',
]);

/** Internal tombstone written after the one-time localStorage migration. */
export const SETTINGS_MIGRATION_VERSION_KEY = '__la_settings_migration_version';
export const SETTINGS_MIGRATION_VERSION = '1';
export const USER_DATA_SCHEMA_VERSION = 1 as const;

const RETIRED_LOCAL_SETTING_KEYS = new Set([
  'la_new_ux_enabled',
  'soda_cookie',
  'soda_cookie_last_check',
]);

/**
 * Keys accepted from the legacy localStorage-only implementation when the
 * desktop settings store is genuinely empty. Keeping this allowlist explicit
 * prevents deleted feature flags and arbitrary stale values from being revived.
 */
const LEGACY_MIGRATABLE_SETTING_KEYS = new Set([
  'app-language',
  'app-shortcuts',
  'app-theme',
  'playback',
  'webdav-config',
  'qq_music_cookie',
  'qq_music_cookie_last_check',
  'netease_cookie',
  'netease_cookie_last_check',
  'la_download_path',
  'la_floating_panel',
  'la_bg_blur_trans',
  'la_qq_music_enabled',
  'la_online_source',
  'la_glass_ui',
  'la_gsap_button_bounce',
  'la_focus_bg_blur_radius',
  'la_focus_lyrics_font_size',
  'la_focus_lyric_line_spacing',
  'la_focus_inactive_lyric_blur',
]);

export function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEYS.has(key);
}

export function isReplaceableCacheSettingKey(key: string): boolean {
  return REPLACEABLE_CACHE_SETTING_KEYS.has(key);
}

export function isRetiredSettingKey(key: string): boolean {
  return RETIRED_LOCAL_SETTING_KEYS.has(key);
}

export function isLegacyMigratableSettingKey(key: string): boolean {
  return LEGACY_MIGRATABLE_SETTING_KEYS.has(key);
}

export function isInternalSettingKey(key: string): boolean {
  return key === SETTINGS_MIGRATION_VERSION_KEY;
}

/**
 * Keys owned by the desktop settings mirror. Unknown origin data is preserved;
 * it is neither migrated into settings.json nor copied into users.json.
 */
export function isAppOwnedLocalStorageKey(key: string): boolean {
  return isLegacyMigratableSettingKey(key)
    || RETIRED_LOCAL_SETTING_KEYS.has(key)
    || key.startsWith('la_');
}

export function filterLegacyMigratableSettings(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter(([key]) => isLegacyMigratableSettingKey(key))
  );
}

export function filterPublicSettings(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter(([key]) => !isInternalSettingKey(key))
  );
}
