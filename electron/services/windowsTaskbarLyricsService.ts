import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { app } from 'electron';
import type { SystemLyricsAction, SystemLyricsState } from '../../src/types/systemLyrics';
import { logger } from '../logger';

export type WindowsTaskbarLyricsActionHandler = (
  action: SystemLyricsAction,
) => void | Promise<void>;

type HelperProcess = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'once' | 'kill' | 'killed'
>;

type HelperSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => HelperProcess;

export interface WindowsTaskbarLyricsServiceDependencies {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  isPackaged: boolean;
  cwd: () => string;
  env: NodeJS.ProcessEnv;
  resourcesPath: string | undefined;
  fileExists: (path: string) => boolean;
  spawnHelper: HelperSpawner;
}

const EMPTY_ACTION_HANDLER: WindowsTaskbarLyricsActionHandler = () => {};
const HELPER_NAME = 'LyricsAdapter.TaskbarLyrics.exe';
const MAX_STDOUT_BUFFER = 64 * 1024;
const STOP_GRACE_PERIOD_MS = 1_500;
const RESTART_BASE_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;
const RESTART_STABLE_PERIOD_MS = 30_000;
const ACTIONS = new Set<SystemLyricsAction>(['toggle-play', 'previous', 'next']);

type HelperWriteResult =
  | { status: 'written' | 'backpressure' }
  | { status: 'failed'; error: unknown };

function runtimeResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function runtimeIdentifier(arch: NodeJS.Architecture): string {
  return arch === 'arm64' ? 'win-arm64' : 'win-x64';
}

/**
 * Finds the separately-published Windows helper. The environment override is
 * useful for development and for downstream packagers that use another layout.
 */
export function resolveWindowsTaskbarLyricsHelperPath(
  dependencies: Pick<
    WindowsTaskbarLyricsServiceDependencies,
    'arch' | 'isPackaged' | 'cwd' | 'env' | 'resourcesPath' | 'fileExists'
  >,
): string | null {
  const packagedCandidate = dependencies.resourcesPath
    ? join(dependencies.resourcesPath, 'native', 'windows-taskbar-lyrics', HELPER_NAME)
    : null;
  if (dependencies.isPackaged) {
    return packagedCandidate && dependencies.fileExists(packagedCandidate)
      ? packagedCandidate
      : null;
  }

  const override = dependencies.env['LYRICS_ADAPTER_TASKBAR_LYRICS_HELPER']?.trim();
  const runtime = runtimeIdentifier(dependencies.arch);
  const candidates = [
    override ? resolve(override) : null,
    packagedCandidate,
    join(dependencies.cwd(), 'dist-native', 'windows-taskbar-lyrics', HELPER_NAME),
    join(
      dependencies.cwd(),
      'native',
      'windows-taskbar-lyrics',
      'bin',
      'Release',
      'net8.0-windows10.0.22000.0',
      runtime,
      'publish',
      HELPER_NAME,
    ),
    join(dependencies.cwd(), 'native', 'windows-taskbar-lyrics', HELPER_NAME),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(candidate => dependencies.fileExists(candidate)) ?? null;
}

function defaultDependencies(): WindowsTaskbarLyricsServiceDependencies {
  return {
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    cwd: () => process.cwd(),
    env: process.env,
    resourcesPath: runtimeResourcesPath(),
    fileExists: existsSync,
    spawnHelper: (command, args, options) => spawn(command, args, options),
  };
}

/**
 * Owns the NDJSON bridge to the native Windows taskbar-lyrics helper. The
 * service has no renderer dependencies: it receives snapshots and emits only
 * player intents, keeping Win32 lifecycle failures out of playback state.
 */
export class WindowsTaskbarLyricsService {
  private readonly dependencies: WindowsTaskbarLyricsServiceDependencies;
  private helper: HelperProcess | null = null;
  private enabled = false;
  private state: SystemLyricsState | null = null;
  private onAction: WindowsTaskbarLyricsActionHandler = EMPTY_ACTION_HANDLER;
  private stdoutBuffer = '';
  private stdoutDecoder = new StringDecoder('utf8');
  private pendingUpdate: SystemLyricsState | null = null;
  private waitingForDrain: HelperProcess | null = null;
  private restartAttempt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;

  constructor(
    dependencies: Partial<WindowsTaskbarLyricsServiceDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  /** Starts the helper. Returns false on non-Windows platforms or spawn failure. */
  start(onAction: WindowsTaskbarLyricsActionHandler): boolean {
    this.onAction = onAction;
    if (this.dependencies.platform !== 'win32') return false;

    this.enabled = true;
    const wasRunning = Boolean(this.helper && !this.helper.killed);
    if (!wasRunning && this.state) this.pendingUpdate = this.state;
    if (this.restartTimer) return true;

    const helper = this.ensureHelper();
    if (!helper) return this.restartTimer !== null;
    this.flushPendingUpdate(helper);
    return true;
  }

  /** Caches the latest snapshot and forwards it when the helper is running. */
  update(state: SystemLyricsState): void {
    this.state = { ...state };
    this.pendingUpdate = this.state;
    if (!this.enabled || this.dependencies.platform !== 'win32') return;
    if (this.restartTimer) return;

    const helper = this.ensureHelper();
    if (helper) this.flushPendingUpdate(helper);
  }

  /** Requests a graceful helper exit, then force-closes it after a short grace period. */
  stop(): void {
    this.enabled = false;
    this.state = null;
    this.pendingUpdate = null;
    this.onAction = EMPTY_ACTION_HANDLER;
    this.stdoutBuffer = '';
    this.stdoutDecoder.end();
    this.stdoutDecoder = new StringDecoder('utf8');
    this.waitingForDrain = null;
    this.restartAttempt = 0;
    this.clearRestartTimer();
    this.clearStableTimer();

    const helper = this.helper;
    this.helper = null;
    if (!helper) return;

    // A stop is never held behind the latest-wins update slot. Previously
    // accepted stream data may still precede it, but no unsent snapshot can.
    if (!helper.killed && !helper.stdin.destroyed && helper.stdin.writable) {
      try {
        helper.stdin.write(`${JSON.stringify({ type: 'stop' })}\n`);
      } catch (error) {
        logger.warn('[WindowsTaskbarLyrics] Failed to send stop to helper:', error);
      }
    }
    try {
      helper.stdin.end();
    } catch (error) {
      logger.warn('[WindowsTaskbarLyrics] Failed to close helper input:', error);
    }

    const killTimer = setTimeout(() => {
      if (!helper.killed) helper.kill();
    }, STOP_GRACE_PERIOD_MS);
    killTimer.unref();
    helper.once('exit', () => clearTimeout(killTimer));
  }

  private ensureHelper(): HelperProcess | null {
    if (this.helper && !this.helper.killed) return this.helper;
    if (this.restartTimer) return null;

    const helperPath = resolveWindowsTaskbarLyricsHelperPath(this.dependencies);
    if (!helperPath) {
      logger.warn(
        '[WindowsTaskbarLyrics] Native helper not found. Set '
        + 'LYRICS_ADAPTER_TASKBAR_LYRICS_HELPER or package the published executable.',
      );
      return null;
    }

    try {
      const helper = this.dependencies.spawnHelper(helperPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.helper = helper;
      this.waitingForDrain = null;
      this.stdoutBuffer = '';
      this.stdoutDecoder = new StringDecoder('utf8');
      this.startStableTimer(helper);

      helper.stdout.on('data', chunk => {
        if (this.helper === helper) this.consumeStdout(chunk);
      });
      helper.stdin.on('error', error => {
        this.handleHelperFailure(
          helper,
          '[WindowsTaskbarLyrics] Helper input pipe failed:',
          error,
          true,
        );
      });
      helper.stderr.on('data', chunk => {
        const diagnostic = Buffer.isBuffer(chunk)
          ? chunk.toString('utf8').trim()
          : String(chunk).trim();
        if (diagnostic) logger.warn('[WindowsTaskbarLyrics helper]', diagnostic);
      });
      helper.once('error', error => {
        this.handleHelperFailure(
          helper,
          '[WindowsTaskbarLyrics] Helper process failed:',
          error,
          false,
        );
      });
      helper.once('exit', (code, signal) => {
        this.handleHelperFailure(
          helper,
          `[WindowsTaskbarLyrics] Helper exited (code=${String(code)}, signal=${String(signal)}).`,
          undefined,
          false,
        );
      });
      return helper;
    } catch (error) {
      logger.error('[WindowsTaskbarLyrics] Failed to start helper:', error);
      this.helper = null;
      this.scheduleRestart();
      return null;
    }
  }

  private flushPendingUpdate(helper: HelperProcess): void {
    if (!this.enabled || this.helper !== helper || this.waitingForDrain === helper) return;
    const state = this.pendingUpdate;
    if (!state) return;

    this.pendingUpdate = null;
    const result = this.writeMessage({ type: 'update', state }, helper);
    if (result.status === 'failed') {
      this.pendingUpdate = this.state;
      this.handleHelperFailure(
        helper,
        '[WindowsTaskbarLyrics] Failed to write to helper:',
        result.error,
        true,
      );
      return;
    }

    if (result.status === 'backpressure') {
      this.waitingForDrain = helper;
      helper.stdin.once('drain', () => {
        if (this.waitingForDrain !== helper) return;
        this.waitingForDrain = null;
        if (this.enabled && this.helper === helper) this.flushPendingUpdate(helper);
      });
    }
  }

  private writeMessage(message: object, helper: HelperProcess): HelperWriteResult {
    if (helper.killed || helper.stdin.destroyed || !helper.stdin.writable) {
      return { status: 'failed', error: new Error('Helper input is not writable.') };
    }
    try {
      return helper.stdin.write(`${JSON.stringify(message)}\n`)
        ? { status: 'written' }
        : { status: 'backpressure' };
    } catch (error) {
      return { status: 'failed', error };
    }
  }

  private handleHelperFailure(
    helper: HelperProcess,
    message: string,
    error: unknown,
    terminate: boolean,
  ): void {
    if (this.helper !== helper) return;

    this.helper = null;
    this.waitingForDrain = null;
    this.clearStableTimer();
    if (this.state) this.pendingUpdate = this.state;

    if (this.enabled) {
      if (error === undefined) logger.warn(message);
      else logger.error(message, error);
      this.scheduleRestart();
    }

    if (terminate && !helper.killed) {
      try {
        helper.kill();
      } catch {
        // The process may already be exiting after a broken pipe.
      }
    }
  }

  private scheduleRestart(): void {
    if (!this.enabled || this.restartTimer) return;

    const exponent = Math.min(this.restartAttempt, 16);
    const delay = Math.min(RESTART_BASE_DELAY_MS * (2 ** exponent), RESTART_MAX_DELAY_MS);
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.enabled) return;
      if (this.state) this.pendingUpdate = this.state;
      const helper = this.ensureHelper();
      if (helper) this.flushPendingUpdate(helper);
    }, delay);
    this.restartTimer.unref();
  }

  private startStableTimer(helper: HelperProcess): void {
    this.clearStableTimer();
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      if (this.helper === helper) this.restartAttempt = 0;
    }, RESTART_STABLE_PERIOD_MS);
    this.stableTimer.unref();
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearStableTimer(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }

  private consumeStdout(chunk: unknown): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    this.stdoutBuffer += this.stdoutDecoder.write(buffer);

    if (this.stdoutBuffer.length > MAX_STDOUT_BUFFER) {
      logger.warn('[WindowsTaskbarLyrics] Discarding oversized helper output.');
      this.stdoutBuffer = '';
      return;
    }

    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.consumeLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private consumeLine(line: string): void {
    try {
      const message = JSON.parse(line) as { type?: unknown; action?: unknown };
      if (message.type !== 'action' || typeof message.action !== 'string') return;
      if (!ACTIONS.has(message.action as SystemLyricsAction)) return;
      this.runAction(message.action as SystemLyricsAction);
    } catch (error) {
      logger.warn('[WindowsTaskbarLyrics] Ignoring malformed helper output:', error);
    }
  }

  private runAction(action: SystemLyricsAction): void {
    try {
      void Promise.resolve(this.onAction(action)).catch(error => {
        logger.warn(`[WindowsTaskbarLyrics] ${action} action failed:`, error);
      });
    } catch (error) {
      logger.warn(`[WindowsTaskbarLyrics] ${action} action failed:`, error);
    }
  }
}

export const windowsTaskbarLyricsService = new WindowsTaskbarLyricsService();
