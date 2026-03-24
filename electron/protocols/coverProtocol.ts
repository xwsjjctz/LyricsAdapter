import { protocol, app } from 'electron';
import path from 'path';
import fs from 'fs';

export function registerCoverProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'cover',
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: false
      }
    }
  ]);

  app.whenReady().then(() => {
    const coverDir = path.join(app.getPath('userData'), 'covers');
    protocol.handle('cover', (request) => {
      const url = request.url.slice('cover://'.length);
      const decodedUrl = decodeURIComponent(url);
      const coverPath = path.join(coverDir, decodedUrl);

      const resolvedPath = path.resolve(coverPath);
      const resolvedCoverDir = path.resolve(coverDir);
      if (!resolvedPath.startsWith(resolvedCoverDir)) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(resolvedPath)) {
        return new Response('Not Found', { status: 404 });
      }

      const fileData = fs.readFileSync(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp'
      };
      const mimeType = mimeTypes[ext] || 'image/jpeg';

      return new Response(fileData, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000'
        }
      });
    });
  });
}