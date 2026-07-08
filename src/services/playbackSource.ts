/**
 * Pure URL builders for audio playback sources.
 *
 * Extracted from usePlayback.ts's inline URL construction so they can be
 * tested independently and reused. Each function is a pure data→URL mapping
 * with no side effects, no React hooks, and no I/O.
 *
 * WebDAV URL resolution is NOT here — it requires an async IPC call to
 * webdavClient.getCdnUrl() which has caching, error-recovery, and state;
 * that remains in usePlayback.
 */

/**
 * Build an `audio://` custom-protocol URL for a local file.
 *
 * The path is normalised and URL-encoded so the main-process audioProtocol
 * can stream the file via Range requests. Windows drive-letter paths are
 * handled by converting backslashes to forward slashes; the `C:` colon is
 * NOT percent-encoded because `encodeURI` (not `encodeURIComponent`) is used —
 * the colon survives as-is, which the audio protocol parser handles.
 */
export function buildLocalAudioUrl(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const urlPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath;
  return `audio://localhost${encodeURI(urlPath)}`;
}

/**
 * Build a `stream://` URL for online (QQ / NetEase) playback.
 *
 * The main-process streamProtocol intercepts this URL, resolves the real CDN
 * URL, attaches the stored cookie, and proxies Range requests. The quality is
 * always 320kbps (the highest available for streaming).
 */
export function buildOnlineStreamUrl(source: string, songmid: string): string {
  return `stream://${source}/${encodeURIComponent(songmid)}?q=320`;
}
