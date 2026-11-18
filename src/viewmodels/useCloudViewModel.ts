import { webdavClient } from '../services/webdavClient';

export interface CloudLoadProgress {
  loaded: number;
  total: number;
}

/**
 * Cloud-library ViewModel: the WebDAV sync surface the shell consumes.
 *
 * `useLibraryCloudSync` runs in the composition root and owns loading and
 * writing the cloud slot; this object only exposes its progress, the manual
 * refresh intent and whether an account is configured.
 */
export interface CloudViewModel {
  /** Progress of the running WebDAV load, or null when idle. */
  loadProgress: CloudLoadProgress | null;
  /** Read at call time: settings can save an account between renders. */
  hasConfig(): boolean;
  /** Re-list WebDAV and apply the diff to the cloud slot. */
  refresh(): Promise<void>;
}

export interface CloudViewModelOptions {
  loadProgress: CloudLoadProgress | null;
  refresh: () => Promise<void>;
}

const hasConfig = () => webdavClient.hasConfig();

export function useCloudViewModel({ loadProgress, refresh }: CloudViewModelOptions): CloudViewModel {
  return { loadProgress, hasConfig, refresh };
}
