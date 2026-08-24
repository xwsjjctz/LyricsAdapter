import { app, ipcMain, nativeImage, Notification, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getWindow } from '../windowManager';
import { logger } from '../logger';
import type { AppNotificationPayload } from '../../src/types/notification';

/**
 * 系统通知：通过 Electron 主进程的 Notification 模块发送。
 *
 * 主进程 Notification 不依赖渲染进程的 notifications 权限授权，
 * 直接走系统通知中心（跨平台一致、官方推荐），点击可聚焦主窗口。
 */

const COVER_FILE_NAME = /^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/i;
const MAX_ARTWORK_DATA_URL_LENGTH = 12 * 1024 * 1024;
const activeNotifications = new Set<Notification>();

function getAppIcon(): NativeImage | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'app-icon.png')]
    : [path.join(app.getAppPath(), 'app-icon.png'), path.resolve('app-icon.png')];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image;
  }
  return null;
}

function resolveCoverPath(url: string): string | null {
  if (!url.startsWith('cover://')) return null;
  try {
    const encodedName = url.slice('cover://'.length).split(/[?#]/, 1)[0]?.replace(/\/$/, '') ?? '';
    const fileName = decodeURIComponent(encodedName);
    if (!COVER_FILE_NAME.test(fileName)) return null;
    const coverDir = path.join(app.getPath('userData'), 'covers');
    const candidate = path.join(coverDir, fileName);
    if (!fs.existsSync(candidate)) return null;
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return candidate;
  } catch {
    return null;
  }
}

function loadArtwork(source: string): NativeImage | null {
  let image: NativeImage;
  if (source.startsWith('data:image/') && source.length <= MAX_ARTWORK_DATA_URL_LENGTH) {
    image = nativeImage.createFromDataURL(source);
  } else {
    const coverPath = resolveCoverPath(source);
    if (!coverPath) return null;
    image = nativeImage.createFromPath(coverPath);
  }
  return image.isEmpty() ? null : image;
}

function escapeXmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

/** Build stacked artwork with the LyricsAdapter icon as a bottom-right badge. */
export function buildNotificationArtworkSvg(artworkDataUrls: string[], appIconDataUrl: string): string {
  const artwork = artworkDataUrls.slice(0, 3);
  const positions = artwork.length === 1
    ? [{ x: 0, y: 0, size: 256 }]
    : artwork.length === 2
      ? [{ x: 0, y: 24, size: 232 }, { x: 24, y: 0, size: 232 }]
      : [{ x: 0, y: 32, size: 224 }, { x: 16, y: 16, size: 224 }, { x: 32, y: 0, size: 224 }];
  const layers = artwork
    .map((dataUrl, index) => ({ dataUrl, position: positions[index]! }))
    .reverse()
    .map(({ dataUrl, position }, index) => {
      const clipId = `cover-${index}`;
      return `<defs><clipPath id="${clipId}"><rect x="${position.x}" y="${position.y}" width="${position.size}" height="${position.size}" rx="28"/></clipPath></defs><image href="${escapeXmlAttribute(dataUrl)}" x="${position.x}" y="${position.y}" width="${position.size}" height="${position.size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`;
    })
    .join('');
  const badge = appIconDataUrl
    ? `<circle cx="218" cy="218" r="35" fill="#1c1828" stroke="white" stroke-opacity="0.9" stroke-width="5"/><image href="${escapeXmlAttribute(appIconDataUrl)}" x="190" y="190" width="56" height="56" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${layers}${badge}</svg>`;
}

function createNotificationIcon(artworkUrls: string[] | undefined): NativeImage | undefined {
  const appIcon = getAppIcon();
  const artwork = (artworkUrls ?? [])
    .slice(0, 3)
    .map(loadArtwork)
    .filter((image): image is NativeImage => image !== null);
  if (artwork.length === 0) return appIcon ?? undefined;
  if (!appIcon) return artwork[0];

  const svg = buildNotificationArtworkSvg(
    artwork.map(image => image.resize({ width: 256, height: 256, quality: 'best' }).toDataURL()),
    appIcon.resize({ width: 64, height: 64, quality: 'best' }).toDataURL(),
  );
  const composite = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  );
  return composite.isEmpty() ? artwork[0] : composite;
}

function retainNotification(notification: Notification): void {
  activeNotifications.add(notification);
  const release = () => activeNotifications.delete(notification);
  notification.once('close', release);
  notification.once('failed', (_event, error) => {
    logger.error('[Notification] Native notification failed:', error);
    release();
  });
  const timer = setTimeout(release, 60_000);
  timer.unref();
}

export function registerNotificationHandlers(): void {
  ipcMain.handle('notification:show', async (_event, payload: AppNotificationPayload) => {
    if (!Notification.isSupported()) {
      logger.warn('[Notification] System notifications not supported on this platform.');
      return { ok: false, reason: 'unsupported' };
    }

    try {
      const { title, body, silent, artworkUrls } = payload;
      const icon = createNotificationIcon(artworkUrls);
      const n = new Notification({
        title,
        body,
        ...(silent !== undefined ? { silent } : {}),
        ...(icon ? { icon } : {}),
      });

      retainNotification(n);

      n.on('click', () => {
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
        }
      });

      const delivery = await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
        let settled = false;
        const finish = (result: { ok: boolean; reason?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        };
        n.once('show', () => {
          logger.info(`[Notification] Shown: ${title}`);
          finish({ ok: true });
        });
        n.once('failed', (_event, error) => {
          finish({ ok: false, reason: error });
        });
        const timeout = setTimeout(() => finish({ ok: true }), 1_500);
        n.show();
      });
      return delivery;
    } catch (err) {
      logger.error('[Notification] Failed to show notification:', err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}
