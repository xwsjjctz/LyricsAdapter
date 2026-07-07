// cover:// 协议封面 URL 的工具函数。
// 主进程 coverProtocol.ts 仅对 cover:// 协议支持 ?size= 缩略图降采样（见 MAX_THUMBNAIL_SIZE），
// 远程(http/blob/data) URL 不经过本地协议，无法缩放，一律原样返回。

const COVER_PROTOCOL = 'cover://';

/** 判断 URL 是否为本地 cover:// 协议（只有它支持 ?size= 缩略图）。 */
export function isCoverUrl(url: string | undefined | null): url is string {
  return !!url && url.startsWith(COVER_PROTOCOL);
}

/**
 * 提取 cover:// URL 对应的封面文件 id（stem）。
 * 去掉协议前缀、查询参数（?size=…）和扩展名，得到与 covers/ 目录文件名（去扩展名）一致的 id，
 * 用于比对封面文件是否仍然存在（如 clear cache 删除后校验 IndexedDB 里的 coverUrl 是否失效）。
 *
 * 非 cover:// URL 返回 null。safeId 经 sanitizeTrackId 清洗不含 '.'，故 lastIndexOf('.') 即扩展名分隔点。
 */
export function coverIdFromUrl(url: string | undefined | null): string | null {
  if (!isCoverUrl(url)) return null;
  const afterProto = url.slice(COVER_PROTOCOL.length).split('?')[0]!;
  const dot = afterProto.lastIndexOf('.');
  return dot > 0 ? afterProto.slice(0, dot) : afterProto;
}

export function parseCoverDataUrl(dataUrl: string | undefined | null): { mime: string; base64: string } | null {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);
  if (!match?.[1] || !match[2]) return null;
  return {
    mime: match[1] === 'image/jpg' ? 'image/jpeg' : match[1],
    base64: match[2],
  };
}

export function sanitizePersistedCoverUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('blob:') || url.startsWith('file:') || url.startsWith('data:')) {
    return '';
  }
  return url;
}

/**
 * 给 cover:// URL 追加一个查询参数，自动判断分隔符 ? / &。
 * 非 cover:// URL 原样返回。用于在同一 URL 上叠加多个参数（如 size 与 retry cache-bust）。
 */
export function appendCoverQuery(
  url: string | undefined,
  key: string,
  value: string | number
): string | undefined {
  if (!url || !url.startsWith(COVER_PROTOCOL)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${value}`;
}

/**
 * 把 cover:// 封面 URL 转成缩略图 URL（追加 ?size=N）。
 * 仅 cover:// 协议生效；远程/blob/data URL 原样返回。
 *
 * size 选择参考（DPR=2 Retina，含 hover scale 余量）：
 *   - 40~56px 容器 → 128（物理 80~112px，1.6x 余量）
 *   - 128px 容器  → 256
 *   - 256px 容器  → 512（受主进程 MAX_THUMBNAIL_SIZE 上限约束）
 */
export function toCoverThumb(url: string | undefined, size: number): string | undefined {
  return appendCoverQuery(url, 'size', size);
}
