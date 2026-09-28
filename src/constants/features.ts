/**
 * User-facing audio uploads are paused while the product scope is simplified.
 * Keep the implementation for a future decision; this is not a user setting.
 * WebDAV playback and existing metadata-cache writes are intentionally separate.
 * See docs/development/product-direction.md before re-enabling.
 */
export const WEBDAV_AUDIO_UPLOAD_ENABLED = false;
