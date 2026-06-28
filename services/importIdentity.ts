import type { Track } from '../types';

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function splitFileName(fileName: string): { baseName: string; ext: string } {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) return { baseName: fileName, ext: '' };
  return {
    baseName: fileName.slice(0, dotIndex),
    ext: fileName.slice(dotIndex),
  };
}

export function getDesktopImportKey(filePath: string): string {
  return `path:${normalizePath(filePath)}`;
}

export function getWebFileImportKey(file: File): string {
  return `file:${file.name}:${file.size}:${file.lastModified}`;
}

export function getTrackImportKeys(track: Track): string[] {
  const keys: string[] = [];

  if (track.filePath) {
    keys.push(getDesktopImportKey(track.filePath));
  }

  const fileSize = track.file?.size ?? track.fileSize;
  const lastModified = track.file?.lastModified ?? track.lastModified;
  if (track.fileName && fileSize !== undefined && lastModified !== undefined) {
    keys.push(`file:${track.fileName}:${fileSize}:${lastModified}`);
  }

  if (track.fileName) {
    keys.push(`name:${track.fileName}`);
  }

  return keys;
}

export function getUniqueWebDAVFileName(fileName: string, existingNames: Set<string>): string {
  if (!existingNames.has(fileName)) return fileName;

  const { baseName, ext } = splitFileName(fileName);
  let index = 1;
  let candidate = `${baseName} (${index})${ext}`;

  while (existingNames.has(candidate)) {
    index += 1;
    candidate = `${baseName} (${index})${ext}`;
  }

  return candidate;
}
