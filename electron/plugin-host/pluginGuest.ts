import type { MusicPluginHost } from '../../src/shared/musicPlugin';
import type { TranslationRequest } from '../../src/shared/plugin';
import { createInlineHandle, type PluginHandle } from '../services/pluginHandle';
import type { GuestToHost, HostToGuest, MessageChannelEnd, PluginDataSnapshot } from './protocol';

/** Log arguments that cannot be cloned (functions, errors, cycles) are sent as text. */
function cloneable(value: unknown): unknown {
  if (value instanceof Error) return value.stack ?? value.message;
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return value;
  try { return structuredClone(value); } catch { return String(value); }
}

/**
 * Runs one plugin inside the plugin host process. Plugin code keeps the
 * synchronous host API it was written for: reads come from the snapshot the
 * main process attaches to each request, writes update the snapshot at once
 * and are forwarded to the main process to persist.
 */
export function startPluginGuest(port: MessageChannelEnd<GuestToHost, HostToGuest>): void {
  let data: PluginDataSnapshot = { secrets: {}, settings: {} };
  let handle: PluginHandle | undefined;
  const cancels = new Map<number, AbortController>();

  const log = (level: 'debug' | 'info' | 'warn' | 'error') => (...args: unknown[]) => port.post({ type: 'log', level, args: args.map(cloneable) });
  const host: MusicPluginHost = {
    logger: { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') },
    readSecret: name => data.secrets[name] ?? '',
    writeSecrets: entries => {
      data = { ...data, secrets: { ...data.secrets, ...entries } };
      port.post({ type: 'writeSecrets', entries: { ...entries } });
    },
    readSetting: key => data.settings[key],
    writeSetting: (key, value) => {
      const settings = { ...data.settings };
      if (value === undefined) delete settings[key]; else settings[key] = value;
      data = { ...data, settings };
      port.post({ type: 'writeSetting', key, value });
    },
  };

  const run = async (op: string, args: unknown[], requestId: number): Promise<unknown> => {
    if (!handle) throw new Error('Plugin host is not initialized');
    switch (op) {
      case 'load': return handle.load();
      case 'call': return handle.call(args[0] as string, args[1] as unknown[]);
      case 'invoke': return handle.invoke(args[0] as string, args[1] as unknown[]);
      case 'streamHeaders': return handle.streamHeaders(args[0] as string);
      case 'translate':
      case 'clearTranslation': {
        const controller = new AbortController();
        cancels.set(requestId, controller);
        try {
          return await handle[op](args[0] as string, args[1] as TranslationRequest, controller.signal, args[2] as string);
        } finally { cancels.delete(requestId); }
      }
      default: throw new Error(`Unknown plugin operation: ${op}`);
    }
  };

  port.onMessage(message => {
    switch (message.type) {
      case 'init':
        data = message.snapshot;
        handle = createInlineHandle(message.spec, host);
        return;
      case 'request':
        data = message.snapshot;
        run(message.op, message.args, message.requestId).then(
          value => port.post({ type: 'response', requestId: message.requestId, ok: true, value: cloneable(value), failure: handle?.failure }),
          error => port.post({ type: 'response', requestId: message.requestId, ok: false, error: (error as Error)?.message ?? String(error), failure: handle?.failure }),
        );
        return;
      case 'cancel':
        cancels.get(message.requestId)?.abort(new Error(message.reason));
        return;
      case 'configurationChanged':
        data = message.snapshot;
        handle?.configurationChanged();
        return;
      case 'ping':
        port.post({ type: 'pong', nonce: message.nonce });
        return;
      case 'dispose':
        for (const controller of cancels.values()) controller.abort(new Error('Plugin is inactive'));
        handle?.dispose();
        handle = undefined;
        return;
    }
  });
}
