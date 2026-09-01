import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { SystemLyricsAction } from '../../src/types/systemLyrics';

export const WINDOWS_TASKBAR_HOST_API_VERSION = 2;
export const WINDOWS_TASKBAR_HOST_EXECUTABLE = 'LyricsAdapter.TaskbarHost.exe';

const MAX_PROTOCOL_LINE_LENGTH = 64 * 1024;
const MAX_ARTWORK_URL_LENGTH = 8192;
const HOST_READY_TIMEOUT_MS = 10_000;
const COVER_FILE_NAME = /^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/iu;
const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64']);

export interface WindowsTaskbarHostState {
  artworkSource: string;
  title: string;
  artist: string;
  line: string;
  nextLine: string;
  lineCursor: number | null;
  lineProgress: number | null;
  isPlaying: boolean;
  placementMode: WindowsTaskbarHostPlacementMode;
  manualPosition: number | null;
}

export type WindowsTaskbarHostPlacementMode = 'auto' | 'manual';

export type WindowsTaskbarHostPlacement =
  | { mode: 'auto'; position: null }
  | { mode: 'manual'; position: number };

export interface WindowsTaskbarHostBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowsTaskbarHostStatus {
  attached: boolean;
  topmost?: boolean;
  reason: string;
  edge?: 'top' | 'bottom';
  dpi?: number;
  boundsPx?: Readonly<WindowsTaskbarHostBounds>;
  placementMode?: WindowsTaskbarHostPlacementMode;
  manualPosition?: number;
  placementAdjusted?: boolean;
  occupiedRegionCount?: number;
}

export type WindowsTaskbarHostMessage =
  | { type: 'ready'; apiVersion: number }
  | { type: 'action'; action: SystemLyricsAction }
  | ({ type: 'placement' } & WindowsTaskbarHostPlacement)
  | ({ type: 'status' } & WindowsTaskbarHostStatus);

export interface WindowsTaskbarHostCallbacks {
  onReady: () => void;
  onAction: (action: SystemLyricsAction) => void;
  onPlacement: (placement: WindowsTaskbarHostPlacement) => void;
  onStatus: (status: WindowsTaskbarHostStatus) => void;
  onError: (error: Error) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onStderr: (line: string) => void;
}

export interface WindowsTaskbarHostBridge {
  update(state: WindowsTaskbarHostState): void;
  setVisible(visible: boolean): void;
  refresh(): void;
  stop(): void;
}

interface HostCommand {
  type: 'update' | 'visibility' | 'refresh' | 'shutdown';
  state?: WindowsTaskbarHostState;
  visible?: boolean;
}

type SpawnHost = (
  executablePath: string,
  args: readonly string[],
) => ChildProcessWithoutNullStreams;

export interface LaunchWindowsTaskbarHostOptions {
  executablePath: string;
  callbacks: WindowsTaskbarHostCallbacks;
  spawnHost?: SpawnHost;
}

export interface ResolveWindowsTaskbarHostPathOptions {
  appPath: string;
  resourcesPath: string;
  isPackaged: boolean;
  arch?: string;
}

function isSystemLyricsAction(value: unknown): value is SystemLyricsAction {
  return value === 'toggle-play' || value === 'previous' || value === 'next';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlacementMode(value: unknown): value is WindowsTaskbarHostPlacementMode {
  return value === 'auto' || value === 'manual';
}

function isBounds(value: unknown): value is WindowsTaskbarHostBounds {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Record<string, unknown>;
  return isFiniteNumber(bounds['x'])
    && isFiniteNumber(bounds['y'])
    && isFiniteNumber(bounds['width'])
    && isFiniteNumber(bounds['height']);
}

/** Validates the small, stdout-only protocol before it reaches playback code. */
export function parseWindowsTaskbarHostMessage(
  line: string,
): WindowsTaskbarHostMessage | null {
  if (!line || line.length > MAX_PROTOCOL_LINE_LENGTH) return null;

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const message = value as Record<string, unknown>;
  if (message['type'] === 'ready' && Number.isInteger(message['apiVersion'])) {
    return { type: 'ready', apiVersion: message['apiVersion'] as number };
  }
  if (message['type'] === 'action' && isSystemLyricsAction(message['action'])) {
    return { type: 'action', action: message['action'] };
  }
  if (message['type'] === 'placement' && isPlacementMode(message['mode'])) {
    if (message['mode'] === 'auto' && message['position'] == null) {
      return { type: 'placement', mode: 'auto', position: null };
    }
    if (
      message['mode'] === 'manual'
      && isFiniteNumber(message['position'])
      && message['position'] >= 0
      && message['position'] <= 1
    ) {
      return {
        type: 'placement',
        mode: 'manual',
        position: message['position'],
      };
    }
    return null;
  }
  if (
    message['type'] === 'status'
    && typeof message['attached'] === 'boolean'
    && typeof message['reason'] === 'string'
  ) {
    const status: WindowsTaskbarHostMessage = {
      type: 'status',
      attached: message['attached'],
      reason: message['reason'],
    };
    if (typeof message['topmost'] === 'boolean') status.topmost = message['topmost'];
    if (message['edge'] === 'top' || message['edge'] === 'bottom') {
      status.edge = message['edge'];
    }
    if (isFiniteNumber(message['dpi'])) status.dpi = message['dpi'];
    if (isBounds(message['boundsPx'])) status.boundsPx = message['boundsPx'];
    if (isPlacementMode(message['placementMode'])) {
      status.placementMode = message['placementMode'];
    }
    if (
      isFiniteNumber(message['manualPosition'])
      && message['manualPosition'] >= 0
      && message['manualPosition'] <= 1
    ) {
      status.manualPosition = message['manualPosition'];
    }
    if (typeof message['placementAdjusted'] === 'boolean') {
      status.placementAdjusted = message['placementAdjusted'];
    }
    if (
      Number.isInteger(message['occupiedRegionCount'])
      && (message['occupiedRegionCount'] as number) >= 0
    ) {
      status.occupiedRegionCount = message['occupiedRegionCount'] as number;
    }
    return status;
  }
  return null;
}

export function resolveWindowsTaskbarHostExecutablePath(
  options: ResolveWindowsTaskbarHostPathOptions,
): string {
  const arch = options.arch ?? process.arch;
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`Unsupported Windows taskbar host architecture: ${arch}`);
  }
  if (options.isPackaged) {
    return path.join(
      options.resourcesPath,
      'windows-taskbar-host',
      WINDOWS_TASKBAR_HOST_EXECUTABLE,
    );
  }
  return path.join(
    options.appPath,
    'native',
    'windows-taskbar-host',
    'publish',
    `win-${arch}`,
    WINDOWS_TASKBAR_HOST_EXECUTABLE,
  );
}

function isPathInsideDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

/** Converts Electron-only cover:// artwork into a file URI the WPF host can read. */
export function resolveWindowsTaskbarArtworkSource(
  value: string,
  userDataPath: string,
): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ARTWORK_URL_LENGTH) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  if (parsed.protocol === 'https:') return parsed.toString();
  if (parsed.protocol !== 'cover:') return '';

  const rawResource = trimmed
    .slice('cover://'.length)
    .split('?', 1)[0]
    ?.replace(/\/$/u, '') ?? '';
  let filename: string;
  try {
    filename = decodeURIComponent(rawResource);
  } catch {
    return '';
  }
  if (
    !COVER_FILE_NAME.test(filename)
    || filename.includes('/')
    || filename.includes('\\')
  ) return '';

  try {
    const coverRoot = fs.realpathSync.native(path.join(userDataPath, 'covers'));
    const candidate = fs.realpathSync.native(path.join(coverRoot, filename));
    if (!isPathInsideDirectory(coverRoot, candidate) || !fs.statSync(candidate).isFile()) {
      return '';
    }
    const fileUrl = pathToFileURL(candidate);
    fileUrl.search = parsed.search;
    return fileUrl.href;
  } catch {
    return '';
  }
}

function defaultSpawnHost(
  executablePath: string,
  args: readonly string[],
): ChildProcessWithoutNullStreams {
  return spawn(executablePath, [...args], {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export class WindowsTaskbarHostClient implements WindowsTaskbarHostBridge {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutLines: readline.Interface;
  private readonly stderrLines: readline.Interface;
  private ready = false;
  private stopped = false;
  private exitReported = false;
  private pendingUpdate: HostCommand | null = null;
  private pendingVisibility: HostCommand | null = null;
  private pendingRefresh = false;
  private readyTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: LaunchWindowsTaskbarHostOptions) {
    const spawnHost = options.spawnHost ?? defaultSpawnHost;
    this.child = spawnHost(options.executablePath, [
      '--protocol-version',
      String(WINDOWS_TASKBAR_HOST_API_VERSION),
    ]);
    this.stdoutLines = readline.createInterface({ input: this.child.stdout });
    this.stderrLines = readline.createInterface({ input: this.child.stderr });

    this.stdoutLines.on('line', line => this.handleStdout(line));
    this.stderrLines.on('line', line => {
      if (line) this.options.callbacks.onStderr(line.slice(0, MAX_PROTOCOL_LINE_LENGTH));
    });
    this.child.stdin.on('error', error => {
      if (!this.stopped) this.options.callbacks.onError(error);
    });
    this.child.on('error', error => {
      if (!this.stopped) this.options.callbacks.onError(error);
    });
    this.child.on('exit', (code, signal) => this.handleExit(code, signal));
    this.child.on('close', (code, signal) => this.handleExit(code, signal));

    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      if (this.ready || this.stopped) return;
      this.options.callbacks.onError(
        new Error('Windows taskbar host timed out before becoming ready.'),
      );
      this.child.kill();
    }, HOST_READY_TIMEOUT_MS);
    this.readyTimer.unref();
  }

  update(state: WindowsTaskbarHostState): void {
    const command: HostCommand = { type: 'update', state };
    if (!this.ready) {
      this.pendingUpdate = command;
      return;
    }
    this.write(command);
  }

  setVisible(visible: boolean): void {
    const command: HostCommand = { type: 'visibility', visible };
    if (!this.ready) {
      this.pendingVisibility = command;
      return;
    }
    this.write(command);
  }

  refresh(): void {
    if (!this.ready) {
      this.pendingRefresh = true;
      return;
    }
    this.write({ type: 'refresh' });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearReadyTimer();
    if (this.ready) this.write({ type: 'shutdown' }, true);
    this.child.stdin.end();

    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.killTimer = setTimeout(() => {
        this.killTimer = null;
        if (this.child.exitCode === null && this.child.signalCode === null) {
          this.child.kill();
        }
      }, 1_000);
      this.killTimer.unref();
    }
  }

  private handleStdout(line: string): void {
    const message = parseWindowsTaskbarHostMessage(line);
    if (!message) {
      this.options.callbacks.onError(
        new Error('Windows taskbar host emitted an invalid protocol message.'),
      );
      return;
    }

    if (message.type === 'ready') {
      if (message.apiVersion !== WINDOWS_TASKBAR_HOST_API_VERSION) {
        this.options.callbacks.onError(new Error(
          `Windows taskbar host API version mismatch (expected ${WINDOWS_TASKBAR_HOST_API_VERSION}, got ${message.apiVersion}).`,
        ));
        this.child.kill();
        return;
      }
      if (this.ready) return;
      this.ready = true;
      this.clearReadyTimer();
      this.flushPending();
      this.options.callbacks.onReady();
      return;
    }
    if (!this.ready) return;
    if (message.type === 'action') {
      this.options.callbacks.onAction(message.action);
      return;
    }
    if (message.type === 'placement') {
      const { type: _type, ...placement } = message;
      this.options.callbacks.onPlacement(placement);
      return;
    }
    const { type: _type, ...status } = message;
    this.options.callbacks.onStatus(status);
  }

  private flushPending(): void {
    if (this.pendingUpdate) this.write(this.pendingUpdate);
    if (this.pendingVisibility) this.write(this.pendingVisibility);
    if (this.pendingRefresh) this.write({ type: 'refresh' });
    this.pendingUpdate = null;
    this.pendingVisibility = null;
    this.pendingRefresh = false;
  }

  private write(command: HostCommand, allowStopped = false): void {
    if ((!allowStopped && this.stopped) || this.child.stdin.destroyed) return;
    const serialized = JSON.stringify(command);
    if (serialized.length > MAX_PROTOCOL_LINE_LENGTH) {
      this.options.callbacks.onError(
        new Error('Windows taskbar host command exceeded the protocol limit.'),
      );
      return;
    }
    this.child.stdin.write(`${serialized}\n`);
  }

  private handleExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.exitReported) return;
    this.exitReported = true;
    this.clearReadyTimer();
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = null;
    this.stdoutLines.close();
    this.stderrLines.close();
    this.options.callbacks.onExit(code, signal);
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }
}

export function launchWindowsTaskbarHost(
  options: LaunchWindowsTaskbarHostOptions,
): WindowsTaskbarHostBridge {
  return new WindowsTaskbarHostClient(options);
}
