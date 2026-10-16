import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type {
  IpcEventArgs,
  IpcEventChannel,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
  IpcSendArgs,
  IpcSendChannel,
} from '../../src/shared/ipcContract';

// Main-process side of src/shared/ipcContract.ts. Register and emit IPC only
// through these helpers so channel names, arguments and results are checked
// against the contract. Argument types describe what a well-behaved renderer
// sends; handlers must still validate them before trusting them.

type InvokeHandler<C extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeArgs<C>
) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>;

export function handleIpc<C extends IpcInvokeChannel>(channel: C, handler: InvokeHandler<C>): void {
  ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
}

/** Listens for a fire-and-forget renderer message; returns the unsubscribe function. */
export function onIpc<C extends IpcSendChannel>(
  channel: C,
  listener: (event: IpcMainEvent, ...args: IpcSendArgs<C>) => void,
): () => void {
  const untyped = listener as (event: IpcMainEvent, ...args: unknown[]) => void;
  ipcMain.on(channel, untyped);
  return () => { ipcMain.removeListener(channel, untyped); };
}

export function sendIpc<C extends IpcEventChannel>(target: WebContents, channel: C, ...args: IpcEventArgs<C>): void {
  target.send(channel, ...args);
}
