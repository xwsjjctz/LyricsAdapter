import { protocol, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger';

const MIME_TYPES: Record<string, string> = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
};

/**
 * Parse Range header value.
 * Supports "bytes=start-end" format. Returns [start, end] or null.
 */
function parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) return null;

  const start = parseInt(match[1]!, 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
    return null;
  }

  return { start, end };
}

/**
 * Register the `audio://` custom protocol for streaming local audio files.
 *
 * The browser's `<audio>` element will issue Range requests for seeking.
 * This handler returns proper 206 Partial Content responses with streaming
 * via `fs.createReadStream`, avoiding loading entire files into memory.
 *
 * URL format: audio://<encoded-file-path>
 */
export function registerAudioProtocol(): void {
  protocol.registerSchemesAsPrivileged([
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
  ]);

  app.whenReady().then(() => {
    protocol.handle('audio', async (request) => {
      try {
        const url = request.url.slice('audio://'.length);
        const decodedPath = decodeURIComponent(url);
        const resolvedPath = path.resolve(decodedPath);

        // Path traversal protection: ensure resolved path is an actual file
        if (!fs.existsSync(resolvedPath)) {
          logger.warn(`[AudioProtocol] File not found: ${resolvedPath}`);
          return new Response('File Not Found', { status: 404 });
        }

        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
          return new Response('Forbidden', { status: 403 });
        }

        const ext = path.extname(resolvedPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const fileSize = stat.size;
        const rangeHeader = request.headers.get('range');

        // Handle Range request (for seeking/timeline scrubbing)
        if (rangeHeader) {
          const range = parseRangeHeader(rangeHeader, fileSize);
          if (range) {
            const { start, end } = range;
            const chunkSize = end - start + 1;

            const stream = fs.createReadStream(resolvedPath, {
              start,
              end,
              highWaterMark: 256 * 1024, // 256KB buffer chunks
            });

            return new Response(stream as unknown as ReadableStream, {
              status: 206,
              headers: {
                'Content-Type': contentType,
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': String(chunkSize),
                'Accept-Ranges': 'bytes',
              },
            });
          }
        }

        // No valid Range header → return full file as stream
        const stream = fs.createReadStream(resolvedPath, {
          highWaterMark: 256 * 1024,
        });

        return new Response(stream as unknown as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(fileSize),
            'Accept-Ranges': 'bytes',
          },
        });
      } catch (error) {
        logger.error('[AudioProtocol] Request error:', error);
        return new Response('Internal Server Error', { status: 500 });
      }
    });

    logger.info('[AudioProtocol] ✓ audio:// protocol registered');
  });
}
