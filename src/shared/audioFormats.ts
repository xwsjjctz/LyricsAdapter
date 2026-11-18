/**
 * Formats local import accepts. Playback, downloads and the cloud library read
 * more containers than this; importing a local file is limited to these two.
 */
export const IMPORTABLE_AUDIO_EXTENSIONS = ['.mp3', '.flac'] as const;

/** `accept` value for a file input. */
export const IMPORTABLE_AUDIO_ACCEPT = IMPORTABLE_AUDIO_EXTENSIONS.join(',');

/** Whether a file name or path ends in an importable extension, ignoring case. */
export function isImportableAudioName(name: string): boolean {
  const lower = name.toLowerCase();
  return IMPORTABLE_AUDIO_EXTENSIONS.some(extension => lower.endsWith(extension));
}

/** Importable audio found beneath user-chosen files and folders. */
export interface AudioPathScan {
  /** Absolute paths, in folder order. */
  filePaths: string[];
  /** A scan limit was reached, so `filePaths` is incomplete. */
  truncated: boolean;
}
