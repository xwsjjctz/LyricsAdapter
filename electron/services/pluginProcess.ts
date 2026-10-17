import type { MusicPluginHost } from '../../src/shared/musicPlugin';
import type { TranslationRequest, TranslationResult } from '../../src/shared/plugin';
import type { GuestToHost, HostToGuest, MessageChannelEnd, PluginDataSnapshot, PluginOperation } from '../plugin-host/protocol';
import type { PluginHandle, PluginHandleSpec } from './pluginHandle';
import { TRANSLATION_TIMEOUT_MS } from './pluginRuntime';

/** One plugin host process as seen from the main process. */
export interface PluginProcessChannel extends MessageChannelEnd<HostToGuest, GuestToHost> {
  onExit(listener: () => void): void;
  kill(): void;
}
export type SpawnPluginProcess = (id: string) => PluginProcessChannel;

interface ProcessHandleOptions {
  spec: PluginHandleSpec;
  /** Main-process host: logging and persistence of the plugin's writes. */
  host: MusicPluginHost;
  /** The plugin's current secrets and settings, attached to every request. */
  snapshot(): PluginDataSnapshot;
  spawn: SpawnPluginProcess;
  requestTimeoutMs?: number;
  /** Translation calls get the runtime's longer deadline plus a margin to report it. */
  translationTimeoutMs?: number;
  pingTimeoutMs?: number;
  now?: () => number;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}

const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;

/**
 * Runs a plugin in its own process. A plugin that blocks its event loop or
 * crashes cannot stall the main process: requests time out, an unresponsive
 * process is killed, and the next request starts a fresh one. A plugin that
 * keeps crashing is marked failed until it is re-enabled.
 */
export class ProcessPluginHandle implements PluginHandle {
  failure: string | undefined;
  private channel: PluginProcessChannel | undefined;
  private pending = new Map<number, Pending>();
  private pings = new Map<number, () => void>();
  private nextId = 1;
  private crashes: number[] = [];
  private disposed: Error | undefined;
  private readonly requestTimeoutMs: number;
  private readonly translationTimeoutMs: number;
  private readonly pingTimeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: ProcessHandleOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.translationTimeoutMs = options.translationTimeoutMs ?? TRANSLATION_TIMEOUT_MS + 5_000;
    this.pingTimeoutMs = options.pingTimeoutMs ?? 3_000;
    this.now = options.now ?? Date.now;
  }

  private ensureChannel(): PluginProcessChannel {
    if (this.channel) return this.channel;
    const channel = this.options.spawn(this.options.spec.id);
    this.channel = channel;
    channel.onMessage(message => this.receive(channel, message));
    channel.onExit(() => this.exited(channel));
    channel.post({ type: 'init', spec: this.options.spec, snapshot: this.options.snapshot() });
    return channel;
  }

  private receive(channel: PluginProcessChannel, message: GuestToHost): void {
    if (channel !== this.channel) return;
    const { host, spec } = this.options;
    switch (message.type) {
      case 'response': {
        const pending = this.pending.get(message.requestId);
        this.failure = message.failure;
        if (!pending) return;
        this.pending.delete(message.requestId);
        pending.cleanup();
        if (message.ok) pending.resolve(message.value); else pending.reject(new Error(message.error));
        return;
      }
      case 'log':
        host.logger[message.level](...message.args);
        return;
      case 'writeSecrets':
        try { host.writeSecrets(message.entries); } catch (error) { host.logger.warn('[PluginProcess] Rejected a secret write', error); }
        return;
      case 'writeSetting':
        // A plugin may only write inside its own data area.
        if (typeof message.key === 'string' && message.key.startsWith(`plugin:${spec.id}:`) && host.writeSetting) {
          host.writeSetting(message.key, typeof message.value === 'string' ? message.value : undefined);
        } else host.logger.warn('[PluginProcess] Rejected a setting write outside the plugin namespace', message.key);
        return;
      case 'pong':
        this.pings.get(message.nonce)?.();
        return;
    }
  }

  private exited(channel: PluginProcessChannel): void {
    if (channel !== this.channel) return;
    this.channel = undefined;
    this.rejectAll(new Error(this.disposed ? this.disposed.message : 'Plugin process exited unexpectedly'));
    if (this.disposed) return;
    const now = this.now();
    this.crashes = [...this.crashes.filter(time => now - time < CRASH_WINDOW_MS), now];
    if (this.crashes.length >= CRASH_LIMIT) this.failure = 'Plugin process crashed repeatedly';
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
  }

  /** A request ran out of time: if the process no longer answers pings it is blocked, so kill it. */
  private checkHealth(channel: PluginProcessChannel): void {
    const nonce = this.nextId++;
    const timer = setTimeout(() => {
      this.pings.delete(nonce);
      if (channel === this.channel) {
        this.options.host.logger.warn('[PluginProcess] Plugin is unresponsive; restarting its process');
        channel.kill();
        this.exited(channel);
      }
    }, this.pingTimeoutMs);
    timer.unref?.();
    this.pings.set(nonce, () => { clearTimeout(timer); this.pings.delete(nonce); });
    channel.post({ type: 'ping', nonce });
  }

  private request(op: PluginOperation, args: unknown[], signal?: AbortSignal, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    if (this.disposed) return Promise.reject(this.disposed);
    if (this.failure === 'Plugin process crashed repeatedly') return Promise.reject(new Error(this.failure));
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Plugin request cancelled'));
    const channel = this.ensureChannel();
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        cleanup();
        reject(new Error('Plugin request timed out'));
        this.checkHealth(channel);
      }, timeoutMs);
      timer.unref?.();
      const onAbort = () => {
        this.pending.delete(requestId);
        cleanup();
        const reason = signal?.reason instanceof Error ? signal.reason : new Error('Plugin request cancelled');
        channel.post({ type: 'cancel', requestId, reason: reason.message });
        reject(reason);
      };
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, { resolve, reject, cleanup });
      channel.post({ type: 'request', requestId, op, args, snapshot: this.options.snapshot() });
    });
  }

  async load(): Promise<void> { await this.request('load', []); }
  call(method: string, args: unknown[]): Promise<unknown> { return this.request('call', [method, args]); }
  invoke(action: string, args: unknown[]): Promise<unknown> { return this.request('invoke', [action, args]); }
  async streamHeaders(cookie: string): Promise<Record<string, string>> {
    const headers = await this.request('streamHeaders', [cookie]);
    if (!headers || typeof headers !== 'object') throw new Error('Invalid plugin stream headers');
    return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }
  async translate(providerId: string, request: TranslationRequest, signal: AbortSignal, requestId: string): Promise<TranslationResult> {
    return await this.request('translate', [providerId, request, requestId], signal, this.translationTimeoutMs) as TranslationResult;
  }
  configurationChanged(): void {
    this.channel?.post({ type: 'configurationChanged', snapshot: this.options.snapshot() });
  }
  dispose(reason = new Error('Plugin is inactive')): void {
    if (this.disposed) return;
    this.disposed = reason;
    this.rejectAll(reason);
    const channel = this.channel;
    if (!channel) return;
    // Let deactivate and subscription cleanup run briefly, then end the process.
    channel.post({ type: 'dispose' });
    const timer = setTimeout(() => channel.kill(), 1_000);
    timer.unref?.();
  }
}
