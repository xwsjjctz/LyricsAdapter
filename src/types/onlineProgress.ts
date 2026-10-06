export interface OnlineProgressEntry {
  type: 'download' | 'upload';
  percent: number;
  phase?: 'preparing' | 'downloading' | 'saving';
  status?: 'completed' | 'error';
  message?: string;
}

export type OnlineProgress = Readonly<Record<string, OnlineProgressEntry>>;

/** Correlates a main-process transfer with the renderer task that started it. */
export interface DownloadProgressEvent {
  requestId?: string | undefined;
  downloaded: number;
  total: number;
  progress: number;
}
