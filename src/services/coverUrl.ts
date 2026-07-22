// 封面 URL 工具。cover:// 由主进程实际降采样；已知支持尺寸参数的
// 在线音乐 CDN 则在请求 URL 上选择目标尺寸，避免先解码 800px+ 原图。

const COVER_PROTOCOL = 'cover://';

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
 * 请求适合显示尺寸的封面。cover:// 追加 ?size=N；网易、QQ、汽水的
 * 已知 CDN URL 改写为其原生缩略图格式；未知远程/blob/data URL 原样返回。
 *
 * size 选择参考（DPR=2 Retina，含 hover scale 余量）：
 *   - 40~56px 容器 → 128（物理 80~112px，1.6x 余量）
 *   - 128px 容器  → 256
 *   - 256px 容器  → 512（受主进程 MAX_THUMBNAIL_SIZE 上限约束）
 */
export function toCoverThumb(url: string | undefined, size: number): string | undefined {
  if (!url) return url;
  const targetSize = Math.max(32, Math.min(1024, Math.round(size)));
  if (url.startsWith(COVER_PROTOCOL)) {
    return appendCoverQuery(url, 'size', targetSize);
  }
  if (!/^https?:\/\//i.test(url)) return url;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    // NetEase image CDN: `?param=800y800`.
    if (host === 'music.126.net' || host.endsWith('.music.126.net')) {
      parsed.searchParams.set('param', `${targetSize}y${targetSize}`);
      return parsed.toString();
    }

    const normalized = parsed.toString();
    let resized = normalized;
    // QQ Music album/artist CDN path: T002R300x300M000 / T001R300x300M000.
    // CDN 只服务 300/800 等大尺寸，请求 128/192/256 会返回 404；统一升到 300，
    // 浏览器会自动缩放显示，不影响视觉。
    if (host === 'gtimg.cn' || host.endsWith('.gtimg.cn')) {
      const qqSize = Math.max(300, targetSize);
      resized = resized.replace(
        /(T00[12]R)\d+x\d+(M000)/i,
        `$1${qqSize}x${qqSize}$2`,
      );
    }
    // Soda image CDN suffix used by sodaMusicApi: ~c5_375x375.jpg.
    resized = resized.replace(
      /~c5_\d+x\d+(?=\.(?:jpe?g|png|webp))/i,
      `~c5_${targetSize}x${targetSize}`,
    );
    return resized === normalized ? url : resized;
  } catch {
    return url;
  }
}
