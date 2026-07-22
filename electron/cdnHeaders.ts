import { session } from 'electron';
import { logger } from './logger';

/**
 * 已知需要 Referer 才能正常返回图片的国内 CDN。
 * 海外访问时，浏览器发的 `<img>` 请求默认带的是 `app://...` 这类本地 origin，
 * QQ CDN 边缘节点会因此返回 404。本模块用 webRequest.onBeforeSendHeaders
 * 拦截出站请求，给已知 CDN 主机补上 Referer，让其按"来自 QQ 官网"对待。
 *
 * 适用范围：仅针对 `<img>` 显示走 CDN 直链的路径。`fetch-cover-base64`
 * 等主进程 fetch 已自带正确的 Referer，不需要再注入。
 */

interface CdnHeaderRule {
  /** 主机后缀（含子域匹配，如 gtimg.cn 也会命中 a.gtimg.cn） */
  hostSuffix: string;
  /** 要注入/覆盖的请求头 */
  headers: Record<string, string>;
}

const CDN_RULES: readonly CdnHeaderRule[] = [
  {
    hostSuffix: 'gtimg.cn',
    headers: {
      // QQ 音乐封面 CDN：T002R/T001R 路径都挂在 y.gtimg.cn 下。
      // 官方页面源域是 https://y.qq.com/，缺这个 Referer 会 404。
      Referer: 'https://y.qq.com/',
    },
  },
];

function matchesRule(hostname: string): CdnHeaderRule | undefined {
  const lower = hostname.toLowerCase();
  return CDN_RULES.find(
    (rule) => lower === rule.hostSuffix || lower.endsWith(`.${rule.hostSuffix}`),
  );
}

/**
 * 注册 CDN 请求头注入。必须在 app.whenReady() 之后调用，且每个
 * session/webRequest 只能注册一次 onBeforeSendHeaders。
 */
export function registerCdnHeaderInjection(): void {
  const sess = session.defaultSession;
  if (!sess) {
    logger.warn('[Main] No default session; skipping CDN header injection');
    return;
  }

  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    let url: URL;
    try {
      url = new URL(details.url);
    } catch {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }

    const rule = matchesRule(url.hostname);
    if (!rule) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }

    // 覆盖 Referer：浏览器为 <img> 自动填的 origin（如 app://）不是 QQ 想要的。
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        ...rule.headers,
      },
    });
  });

  logger.info(
    '[Main] CDN header injection registered for:',
    CDN_RULES.map((r) => r.hostSuffix).join(', '),
  );
}