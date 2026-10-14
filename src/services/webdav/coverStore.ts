import { getDesktopAPIAsync } from '../desktopAdapter';
import { logger } from '../logger';
import { webdavCoverId } from '../webdavClient';

/** Cover conversions for WebDAV tracks: blob → data:, data: → local cover://, cover:// → portable data:. */

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

/** Reads a parser-created blob: URL into a data: URL and revokes it; '' on failure. */
export async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  if (!blobUrl || !blobUrl.startsWith('blob:')) return blobUrl;
  try {
    const response = await fetch(blobUrl);
    return await blobToDataUrl(await response.blob());
  } catch {
    return '';
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * 在渲染进程读取 cover://（本机封面协议）并转为可移植 data: URL。
 *
 * 必须用渲染端 fetch：cover 注册为 privileged(supportFetchAPI) 的自定义协议，
 * 只有渲染进程的 fetch（Chromium）能解析它；主进程全局 fetch(undici) 不支持自定义协议，
 * 故不能走 fetch-cover-base64 这个 IPC（它在主进程裸 fetch，只对 http 有效）。
 * 文件缺失（404）或读取失败返回 undefined。
 */
export async function readLocalCoverAsDataUrl(coverUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(coverUrl);
    if (!res.ok) return undefined;
    const dataUrl = await blobToDataUrl(await res.blob());
    return dataUrl.startsWith('data:') ? dataUrl : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把封面 URL 转成可移植的 data: 形式，用于写入 WebDAV /Metadata/ 切片。
 *
 * /Metadata/ 是跨机器的可移植边界：切片必须自包含，绝不能存本机 cover:// 指针，
 * 否则其他机器读到的是指向本机磁盘的悬空引用（cover:// 404）。
 *  - cover:// → 渲染端 fetch 本机文件转 data:；读不到返回 undefined（不写悬空指针）
 *  - data:    → 原样（已可移植）
 *  - 其它（http/blob/file 占位等）→ undefined（不持久化进切片）
 */
export async function materializePortableCover(coverUrl: string | undefined | null): Promise<string | undefined> {
  if (!coverUrl) return undefined;
  if (coverUrl.startsWith('data:')) return coverUrl;
  if (!coverUrl.startsWith('cover://')) return undefined;
  // 本机文件缺失时返回 undefined，交由调用方决定回退（如从 webdav 音频重新解析）。
  return readLocalCoverAsDataUrl(coverUrl);
}

/**
 * Saves a data: cover to the local cover store (desktop) and returns its
 * cover:// URL, so it is lazily loaded instead of kept in memory. Returns the
 * input unchanged when it is not a data: URL or cannot be stored. The id is a
 * stable hash of the WebDAV path, shared with the upload flow.
 */
export async function storeCoverLocally(coverUrl: string, webdavPath: string): Promise<string> {
  if (!coverUrl.startsWith('data:')) return coverUrl;
  try {
    const desktopAPI = await getDesktopAPIAsync();
    if (!desktopAPI?.saveCoverThumbnail) {
      logger.warn('[WebDAVCover] saveCoverThumbnail not available');
      return coverUrl;
    }
    const mimeMatch = coverUrl.match(/^data:(\w+\/\w+);base64,/);
    const base64Match = coverUrl.match(/^data:\w+\/\w+;base64,(.+)$/);
    if (!mimeMatch || !base64Match) {
      logger.warn('[WebDAVCover] Cover data URL not recognised for', webdavPath);
      return coverUrl;
    }
    const result = await desktopAPI.saveCoverThumbnail({
      id: webdavCoverId(webdavPath),
      data: base64Match[1]!,
      mime: mimeMatch[1]!,
    });
    if (result?.success && result.coverUrl) return result.coverUrl;
    logger.warn('[WebDAVCover] saveCoverThumbnail failed:', result?.error, 'for', webdavPath);
  } catch (error) {
    logger.warn('[WebDAVCover] Failed to save cover to disk:', error);
  }
  return coverUrl;
}
