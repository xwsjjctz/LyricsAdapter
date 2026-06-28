const WINDOWS_RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const UNSAFE_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001F\u007F]/g;

function cleanFileNameText(value: string): string {
  return value
    .replace(UNSAFE_FILE_CHARS, ' ')
    .replace(/\.\.+/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
}

export function sanitizeFileNamePart(input: string | null | undefined, fallback = 'Unknown'): string {
  const fallbackText = cleanFileNameText(fallback) || 'Unknown';
  let safe = cleanFileNameText(input || '') || fallbackText;

  if (WINDOWS_RESERVED_BASENAME.test(safe)) {
    safe = `_${safe}`;
  }

  safe = safe.slice(0, 180).trim().replace(/[.\s]+$/g, '');
  return safe || fallbackText;
}

export function sanitizeFileExtension(extension: string): string {
  const safeExtension = extension.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(safeExtension)) {
    throw new Error('Invalid file extension');
  }
  return safeExtension;
}

export function buildSafeMusicFileName(artist: string, title: string, extension: string): string {
  const safeArtist = sanitizeFileNamePart(artist, 'Unknown');
  const safeTitle = sanitizeFileNamePart(title, 'Unknown Track');
  const safeExtension = sanitizeFileExtension(extension);
  return `${safeArtist} - ${safeTitle}.${safeExtension}`;
}

export function joinDownloadPath(downloadPath: string, fileName: string): string {
  const basePath = downloadPath.trim();
  if (!basePath) {
    throw new Error('Download path is not set');
  }
  const separator = basePath.endsWith('/') || basePath.endsWith('\\') ? '' : '/';
  return `${basePath}${separator}${fileName}`;
}
