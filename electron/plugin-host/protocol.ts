import type { PluginHandleSpec } from '../services/pluginHandle';

/**
 * Messages between the main process and a plugin host process. Everything is
 * structured-cloneable; errors cross the boundary as messages.
 */

/** The plugin's own secrets (by name) and settings (by full key), sent with every request. */
export interface PluginDataSnapshot {
  secrets: Record<string, string>;
  settings: Record<string, string>;
}

export type PluginOperation = 'load' | 'call' | 'invoke' | 'streamHeaders' | 'translate';

export type HostToGuest =
  | { type: 'init'; spec: PluginHandleSpec; snapshot: PluginDataSnapshot }
  | { type: 'request'; requestId: number; op: PluginOperation; args: unknown[]; snapshot: PluginDataSnapshot }
  | { type: 'cancel'; requestId: number; reason: string }
  | { type: 'configurationChanged'; snapshot: PluginDataSnapshot }
  | { type: 'ping'; nonce: number }
  | { type: 'dispose' };

export type GuestToHost =
  | { type: 'response'; requestId: number; ok: true; value: unknown; failure?: string | undefined }
  | { type: 'response'; requestId: number; ok: false; error: string; failure?: string | undefined }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; args: unknown[] }
  | { type: 'writeSecrets'; entries: Record<string, string> }
  | { type: 'writeSetting'; key: string; value: string | undefined }
  | { type: 'pong'; nonce: number };

/** A bidirectional message channel; implemented over utilityProcess ports and in-memory in tests. */
export interface MessageChannelEnd<Out, In> {
  post(message: Out): void;
  onMessage(listener: (message: In) => void): void;
}
