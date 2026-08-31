import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TaskbarLyricsRendererState } from '../src/taskbar-lyrics/viewModel';

const STATE_CHANNEL = 'taskbar-lyrics-state';
type StateListener = (state: TaskbarLyricsRendererState) => void;

let latestState: TaskbarLyricsRendererState | null = null;
const listeners = new Set<StateListener>();

function isTaskbarLyricsRendererState(value: unknown): value is TaskbarLyricsRendererState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return typeof state['coverUrl'] === 'string'
    && typeof state['line'] === 'string'
    && typeof state['nextLine'] === 'string';
}

ipcRenderer.on(STATE_CHANNEL, (_event: IpcRendererEvent, payload: unknown) => {
  if (!isTaskbarLyricsRendererState(payload)) return;
  const state: TaskbarLyricsRendererState = {
    coverUrl: payload.coverUrl,
    line: payload.line,
    nextLine: payload.nextLine,
  };
  latestState = state;
  for (const listener of listeners) listener(state);
});

contextBridge.exposeInMainWorld('taskbarLyrics', {
  onState(callback: StateListener): () => void {
    listeners.add(callback);
    if (latestState) callback(latestState);
    return () => listeners.delete(callback);
  },
});
