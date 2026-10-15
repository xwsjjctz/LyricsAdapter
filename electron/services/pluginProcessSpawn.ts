import path from 'node:path';
import { app, utilityProcess } from 'electron';
import type { GuestToHost, HostToGuest } from '../plugin-host/protocol';
import type { PluginProcessChannel } from './pluginProcess';

/** Starts a plugin host utility process; messages posted before it spawns are queued. */
export function spawnPluginProcess(id: string): PluginProcessChannel {
  const entry = path.join(app.getAppPath(), 'dist-electron', 'pluginHost.js');
  const child = utilityProcess.fork(entry, [], { serviceName: `LyricsAdapter plugin ${id}`, stdio: 'ignore' });
  let spawned = false;
  const queue: HostToGuest[] = [];
  child.once('spawn', () => {
    spawned = true;
    for (const message of queue.splice(0)) child.postMessage(message);
  });
  return {
    post: message => { if (spawned) child.postMessage(message); else queue.push(message); },
    onMessage: listener => { child.on('message', message => listener(message as GuestToHost)); },
    onExit: listener => { child.once('exit', () => listener()); },
    kill: () => { child.kill(); },
  };
}
