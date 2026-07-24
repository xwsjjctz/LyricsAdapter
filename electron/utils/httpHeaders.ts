// Shared HTTP header builders for outbound requests that impersonate a desktop
// browser. Previously the QQ Music User-Agent + Referer combination was copied
// verbatim into 7 call sites (typedHandlers, downloadHandlers, qqMusicHandlers,
// metadataHandlers); centralising it here means a UA bump or Referer change is
// a one-line edit.

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

/**
 * QQ Music headers: desktop Chrome UA + y.qq.com Referer + optional Cookie.
 * Callers may spread additional headers on top (e.g. Content-Type, Accept-Language).
 */
export function qqMusicHeaders(cookieString?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_UA,
    Referer: 'https://y.qq.com/',
  };
  if (cookieString) {
    headers['Cookie'] = cookieString;
  }
  return headers;
}

export { DESKTOP_UA };
