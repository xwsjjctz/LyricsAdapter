import { protocol, app, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '../logger';

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
 * Register the app:// protocol handler that serves the packaged app's
 * static files from the dist/ directory.
 */
export function registerAppProtocolHandler(): void {
  app.whenReady().then(() => {
    const distDir = path.join(__dirname, '../../dist');

    protocol.handle('app', (request) => {
      try {
        const url = new URL(request.url);
        const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const filePath = path.join(distDir, relativePath);

        const resolvedFile = path.resolve(filePath);
        const resolvedDist = path.resolve(distDir);
        if (!resolvedFile.startsWith(resolvedDist)) {
          logger.warn('[app://] Path traversal blocked:', resolvedFile);
          return new Response('Forbidden', { status: 403 });
        }

        return net.fetch(pathToFileURL(resolvedFile).href);
      } catch (err) {
        logger.error('[app://] Handler error:', err);
        return new Response('Internal Error', { status: 500 });
      }
    });

    logger.info('[app://] Protocol handler registered, dist:', distDir);
  });
}
