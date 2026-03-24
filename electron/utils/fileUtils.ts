import path from 'path';
import fs from 'fs';
import os from 'os';
import { createHash } from 'crypto';
import { app } from 'electron';

export function sanitizeFileName(fileName: string): string {
  const sanitized = fileName.replace(/[\/\\]/g, '').replace(/\.\./g, '').replace(/[<>:"|?*]/g, '');
  if (sanitized !== fileName || sanitized.length === 0) {
    throw new Error('Invalid file name');
  }
  return sanitized;
}

export function sanitizeTrackId(trackId: string): string {
  const cleaned = trackId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (cleaned.length >= 6) {
    return cleaned;
  }
  return createHash('sha1').update(trackId).digest('hex');
}

export function expandHomeDir(inputPath: string): string {
  if (inputPath.startsWith('~/') || inputPath === '~') {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

export function validateSourcePath(sourcePath: string): boolean {
  try {
    const resolved = path.resolve(sourcePath);
    const homeDirs = [
      app.getPath('home'),
      path.join('/Users'),
      path.join('/home'),
    ];

    return homeDirs.some(dir => {
      try {
        return fs.existsSync(dir) && resolved.startsWith(dir);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function coverExtFromMime(mime?: string): string {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg')) return 'jpg';
  return 'jpg';
}

export function detectFileFormat(filePath: string): string {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(12);
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);

    if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) {
      return 'flac';
    }
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return 'mp3';
    }
    if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
      return 'm4a';
    }

    return 'unknown';
  } catch {
    return 'error';
  }
}