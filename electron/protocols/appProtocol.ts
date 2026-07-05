import { protocol, app, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '../logger';

/**
 * Registers the `app://` custom privileged scheme so that the packaged app
 * loads its HTML via `app://localhost/index.html` instead of `file://...`.
 *
 * `file://` gives the page an opaque origin which causes Chromium to silently
 * disable GPU-composited features like `backdrop-filter: blur()`.  A proper
 * scheme with `secure: true` and `standard: true` restores full GPU
 * compositing support.
 */
export function registerAppProtocol(): void {
  // Must be called before app.whenReady()
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
  ]);

  app.whenReady().then(() => {
    // Resolve the dist directory — works both in dev (dist-electron/ is sibling)
    // and in packaged asar (dist-electron/ is inside resources/).
    const distDir = path.join(__dirname, '../../dist');

    protocol.handle('app', (request) => {
      // request.url looks like "app://localhost/index.html" or "app://localhost/assets/index-abc123.js"
      const url = new URL(request.url);
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filePath = path.join(distDir, relativePath);

      // Security: ensure resolved path stays within dist directory
      const resolvedFile = path.resolve(filePath);
      const resolvedDist = path.resolve(distDir);
      if (!resolvedFile.startsWith(resolvedDist)) {
        logger.warn('[app://] Path traversal blocked:', resolvedFile);
        return new Response('Forbidden', { status: 403 });
      }

      return net.fetch(pathToFileURL(resolvedFile).href);
    });

    logger.info('[app://] Protocol registered, dist:', distDir);
  });
}
