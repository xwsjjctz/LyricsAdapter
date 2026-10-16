import { startPluginGuest } from '../../../electron/plugin-host/pluginGuest';
import type { GuestToHost, HostToGuest } from '../../../electron/plugin-host/protocol';
import type { PluginProcessChannel } from '../../../electron/services/pluginProcess';

/**
 * Runs the real guest in this process; every message is structured-cloned and
 * delivered asynchronously, as it would be across a utility-process port.
 */
export function inMemorySpawn() {
  const processes: { id: string; killed: boolean }[] = [];
  const spawn = (id: string): PluginProcessChannel => {
    const state = { id, killed: false };
    processes.push(state);
    let toHost: ((message: GuestToHost) => void) | undefined;
    let onExit: (() => void) | undefined;
    const toGuest: ((message: HostToGuest) => void)[] = [];
    startPluginGuest({
      post: message => { const copy = structuredClone(message); setTimeout(() => { if (!state.killed) toHost?.(copy); }, 0); },
      onMessage: listener => { toGuest.push(listener); },
    });
    return {
      post: message => { const copy = structuredClone(message); setTimeout(() => { if (!state.killed) toGuest.forEach(listener => listener(copy)); }, 0); },
      onMessage: listener => { toHost = listener; },
      onExit: listener => { onExit = listener; },
      kill: () => { if (state.killed) return; state.killed = true; setTimeout(() => onExit?.(), 0); },
    };
  };
  return { spawn, processes };
}

