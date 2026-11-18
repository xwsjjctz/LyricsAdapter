// Utility-process entry: runs one plugin in isolation from the main process.
// See services/plugins/pluginProcess.ts for the main-process side of the protocol.
import { startPluginGuest } from './pluginGuest';
import type { HostToGuest } from './protocol';

const parentPort = process.parentPort;
startPluginGuest({
  post: message => parentPort.postMessage(message),
  onMessage: listener => parentPort.on('message', event => listener(event.data as HostToGuest)),
});
