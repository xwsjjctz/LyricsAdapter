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

// QQ Music CDN (y.gtimg.cn) 仅服务这一组离散封面尺寸；其余尺寸一律 404。
// 实测于 2026-07，与 Referer / 地区无关。按需更新——若发现新的可用尺寸加进来即可。
const QQ_CDN_COVER_SIZES = [120, 150, 180, 300, 500, 800] as const;

/** 把任意请求尺寸向上 snap 到 QQ CDN 实际服务的最近尺寸（超过 800 封顶到 800）。 */
function snapToQqCdnSize(target: number): number {
  for (const s of QQ_CDN_COVER_SIZES) {
    if (target <= s) return s;
  }
  // 数组非空且已排序，封顶到最大档。
  return QQ_CDN_COVER_SIZES[QQ_CDN_COVER_SIZES.length - 1]!;
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

    // Placeholder artwork is seed-stable, so requesting the display size keeps
    // the same image while avoiding a 1000x1000 decoded texture for a 40px row.
    if (host === 'picsum.photos') {
      parsed.pathname = parsed.pathname.replace(
        /\/\d+\/\d+\/?$/,
        `/${targetSize}/${targetSize}`,
      );
      return parsed.toString();
    }

    const normalized = parsed.toString();
    let resized = normalized;
    // QQ Music album/artist CDN path: T002R300x300M000 / T001R300x300M000.
    // 实测 CDN 只服务一组离散尺寸 {120,150,180,300,500,800}，任何其他值
    // （128/200/256/400/512/640/1024 等）一律返回 404——与 Referer / 地区无关。
    // 把任意请求向上 snap 到最近的可用尺寸（超过 800 的封顶到 800，浏览器缩放显示）。
    // 注：以前这里不重写远程 URL，<img> 拿到的总是 API 给的 300（恰好可用）；
    // 7e1570d 引入按容器尺寸重写后才开始产生 128/256/512 这类无效 URL。
    if (host === 'gtimg.cn' || host.endsWith('.gtimg.cn')) {
      const qqSize = snapToQqCdnSize(targetSize);
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
