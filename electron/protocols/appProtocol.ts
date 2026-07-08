import { protocol, app, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '../logger';

function getRendererDistDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'dist');
  }

  return process.env['DIST'] ?? path.join(app.getAppPath(), 'dist');
}

function isInsideDirectory(filePath: string, rootDir: string): boolean {
  const relativePath = path.relative(rootDir, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

/**
 * Registers ALL custom schemes in a single registerSchemesAsPrivileged call.
 * Electron only honours the FIRST call — subsequent calls are silently ignored.
 *
 * Custom schemes:
 *   app://    — serves the packaged app's static files (dist/)
 *   cover://  — serves cached album cover images
 *   audio://  — serves local audio files
 *   stream:// — serves proxied streaming audio
 */
export function registerAllSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: false,
        bypassCSP: false,
      },
    },
    {
      scheme: 'cover',
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: false,
      },
    },
    {
      scheme: 'audio',
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: false,
        stream: true,
      },
    },
    {
      scheme: 'stream',
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: false,
        stream: true,
      },
    },
  ]);
}

/**
 * Register the app:// protocol handler.
 *
 * - Packaged (production): serves static files from dist/.
 * - Dev (Vite dev server): proxies to http://localhost:3000 so that the page
 *   origin stays app://localhost in both modes. This unifies localStorage and
 *   IndexedDB storage across dev and production builds.
 */
export async function registerAppProtocolHandler(): Promise<void> {
  await app.whenReady();

  const distDir = getRendererDistDir();

  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);

      if (!app.isPackaged) {
        // Dev mode: proxy to Vite dev server.
        // Forward headers + method so Vite can properly negotiate content type
        // (especially important for CSS and JS modules).
        const targetUrl = `http://localhost:3000${url.pathname}${url.search}`;
        try {
          const headers = new Headers();
          for (const [key, value] of request.headers.entries()) {
            headers.set(key, value);
          }
          // Remove host header to let Vite handle it
          headers.delete('host');
          return await net.fetch(targetUrl, {
            method: request.method,
            headers,
          });
        } catch (proxyErr) {
          logger.warn('[app://] Dev proxy failed — is Vite dev server running?', (proxyErr as Error).message);
          return new Response('Vite dev server not available', { status: 502 });
        }
      }

      // Packaged mode: serve static files from dist/
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const filePath = path.join(distDir, relativePath);

      const resolvedFile = path.resolve(filePath);
      const resolvedDist = path.resolve(distDir);
      if (!isInsideDirectory(resolvedFile, resolvedDist)) {
        logger.warn('[app://] Path traversal blocked:', resolvedFile);
        return new Response('Forbidden', { status: 403 });
      }

      return net.fetch(pathToFileURL(resolvedFile).href);
    } catch (err) {
      logger.error('[app://] Handler error:', err);
      return new Response('Internal Error', { status: 500 });
    }
  });

  logger.info('[app://] Protocol handler registered (dev=' + !app.isPackaged + '), dist:', distDir);
}
