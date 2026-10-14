/**
 * Auto-updater state shared by electron/updater.ts (sender) and the renderer
 * (receiver). The main process sends electron-updater's richer objects; these
 * are the fields the renderer relies on.
 */
export type UpdaterUnavailableReason = 'dev' | 'unsupported' | 'unsigned' | 'unconfigured';

export interface UpdateInfo {
  version: string;
  releaseName?: string | null | undefined;
  releaseDate?: string | undefined;
}

export interface UpdateProgress {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
}

export type UpdaterState =
  | { status: 'unavailable'; reason: UpdaterUnavailableReason }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'not-available' }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'downloading'; info: UpdateInfo; progress: UpdateProgress | null }
  | { status: 'downloaded'; info: UpdateInfo }
  | { status: 'error'; message: string };
