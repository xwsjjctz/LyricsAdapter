import fs from 'node:fs';
import { app, powerMonitor } from 'electron';
import type { SystemLyricsAction, SystemLyricsState } from '../../src/types/systemLyrics';
import { logger } from '../logger';
import {
  launchWindowsTaskbarHost,
  resolveWindowsTaskbarArtworkSource,
  resolveWindowsTaskbarHostExecutablePath,
  type LaunchWindowsTaskbarHostOptions,
  type WindowsTaskbarHostBridge,
  type WindowsTaskbarHostPlacement,
  type WindowsTaskbarHostState,
  type WindowsTaskbarHostStatus,
} from '../native/windowsTaskbarHost';
import { settingsStore } from './settingsStore';

export type WindowsTaskbarLyricsActionHandler = (
  action: SystemLyricsAction,
) => void | Promise<void>;

type DisposeSubscription = () => void;

export interface WindowsTaskbarLyricsServiceDependencies {
  platform: NodeJS.Platform;
  hostExecutablePath: string;
  hostExists: (executablePath: string) => boolean;
  launchHost: (options: LaunchWindowsTaskbarHostOptions) => WindowsTaskbarHostBridge;
  resolveArtworkSource: (coverUrl: string) => string;
  loadPlacement: () => WindowsTaskbarHostPlacement;
  savePlacement: (placement: WindowsTaskbarHostPlacement) => boolean;
  subscribeSessionChanges: (
    onLock: () => void,
    onUnlock: () => void,
  ) => DisposeSubscription;
}

const RESTART_BASE_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;
const TASKBAR_PLACEMENT_SETTING_KEY = 'la_windows_taskbar_lyrics_placement';
const EMPTY_ACTION_HANDLER: WindowsTaskbarLyricsActionHandler = () => {};
const AUTO_PLACEMENT: WindowsTaskbarHostPlacement = {
  mode: 'auto',
  position: null,
};

export function parseWindowsTaskbarLyricsPlacement(
  value: string | undefined,
): WindowsTaskbarHostPlacement {
  if (!value) return { ...AUTO_PLACEMENT };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed['mode'] === 'manual'
      && typeof parsed['position'] === 'number'
      && Number.isFinite(parsed['position'])
      && parsed['position'] >= 0
      && parsed['position'] <= 1
    ) {
      return { mode: 'manual', position: parsed['position'] };
    }
  } catch {
    // Invalid or legacy values deliberately fall back to safe auto placement.
  }
  return { ...AUTO_PLACEMENT };
}

function defaultDependencies(): WindowsTaskbarLyricsServiceDependencies {
  return {
    platform: process.platform,
    hostExecutablePath: resolveWindowsTaskbarHostExecutablePath({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
    }),
    hostExists: executablePath => fs.existsSync(executablePath),
    launchHost: options => launchWindowsTaskbarHost(options),
    resolveArtworkSource: coverUrl => (
      resolveWindowsTaskbarArtworkSource(coverUrl, app.getPath('userData'))
    ),
    loadPlacement: () => parseWindowsTaskbarLyricsPlacement(
      settingsStore.get(TASKBAR_PLACEMENT_SETTING_KEY),
    ),
    savePlacement: placement => settingsStore.set(
      TASKBAR_PLACEMENT_SETTING_KEY,
      JSON.stringify(placement),
    ),
    subscribeSessionChanges: (onLock, onUnlock) => {
      powerMonitor.on('lock-screen', onLock);
      powerMonitor.on('suspend', onLock);
      powerMonitor.on('unlock-screen', onUnlock);
      powerMonitor.on('resume', onUnlock);
      return () => {
        powerMonitor.removeListener('lock-screen', onLock);
        powerMonitor.removeListener('suspend', onLock);
        powerMonitor.removeListener('unlock-screen', onUnlock);
        powerMonitor.removeListener('resume', onUnlock);
      };
    },
  };
}

function finiteIndex(value: number | null): number | null {
  return value !== null && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

/**
 * Owns the Windows-only C# WPF taskbar host. Electron sends presentation state
 * over a private stdio channel; only player intents cross back into the app.
 */
export class WindowsTaskbarLyricsService {
  private readonly dependencies: WindowsTaskbarLyricsServiceDependencies;
  private host: WindowsTaskbarHostBridge | null = null;
  private state: SystemLyricsState | null = null;
  private onAction: WindowsTaskbarLyricsActionHandler = EMPTY_ACTION_HANDLER;
  private enabled = false;
  private sessionLocked = false;
  private restartAttempt = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private subscriptions: DisposeSubscription[] = [];
  private lastCoverUrl = '';
  private lastArtworkSource = '';
  private lastStatusKey = '';
  private placement: WindowsTaskbarHostPlacement = { ...AUTO_PLACEMENT };

  constructor(
    dependencies: Partial<WindowsTaskbarLyricsServiceDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  /** Enables the Windows surface without starting a process before playback. */
  start(onAction: WindowsTaskbarLyricsActionHandler): boolean {
    this.onAction = onAction;
    if (this.dependencies.platform !== 'win32') return false;
    if (this.enabled) return true;

    if (!this.dependencies.hostExists(this.dependencies.hostExecutablePath)) {
      logger.error(
        '[WindowsTaskbarLyrics] C# taskbar host is unavailable:',
        this.dependencies.hostExecutablePath,
      );
      return false;
    }

    try {
      this.placement = this.dependencies.loadPlacement();
    } catch (error) {
      this.placement = { ...AUTO_PLACEMENT };
      logger.warn('[WindowsTaskbarLyrics] Failed to load taskbar placement:', error);
    }

    this.enabled = true;
    this.subscriptions = [
      this.dependencies.subscribeSessionChanges(
        () => {
          this.sessionLocked = true;
          this.setHostVisible(false);
        },
        () => {
          this.sessionLocked = false;
          this.ensureHost()?.refresh();
          this.renderState();
        },
      ),
    ];
    return true;
  }

  /** Caches the latest renderer snapshot and forwards only the newest state. */
  update(state: SystemLyricsState): void {
    this.state = { ...state };
    if (!this.enabled || this.dependencies.platform !== 'win32') return;

    if (!state.trackId) {
      this.clearRestartTimer();
      this.restartAttempt = 0;
      this.setHostVisible(false);
      return;
    }

    this.ensureHost();
    this.renderState();
  }

  /** Stops the native host and unregisters every global listener. */
  stop(): void {
    this.enabled = false;
    this.state = null;
    this.sessionLocked = false;
    this.restartAttempt = 0;
    this.lastCoverUrl = '';
    this.lastArtworkSource = '';
    this.lastStatusKey = '';
    this.onAction = EMPTY_ACTION_HANDLER;
    this.clearRestartTimer();

    for (const dispose of this.subscriptions.splice(0)) dispose();

    const host = this.host;
    this.host = null;
    if (host) {
      try {
        host.setVisible(false);
        host.stop();
      } catch (error) {
        logger.warn('[WindowsTaskbarLyrics] Failed to stop C# taskbar host:', error);
      }
    }
  }

  private ensureHost(): WindowsTaskbarHostBridge | null {
    if (this.host || !this.enabled || !this.state?.trackId) return this.host;
    if (this.restartTimer || this.sessionLocked) return null;

    try {
      let launchedHost: WindowsTaskbarHostBridge;
      launchedHost = this.dependencies.launchHost({
        executablePath: this.dependencies.hostExecutablePath,
        callbacks: {
          onReady: () => {
            if (this.host !== launchedHost) return;
            this.restartAttempt = 0;
            logger.info('[WindowsTaskbarLyrics] C# taskbar host is ready.');
          },
          onAction: action => {
            if (this.host === launchedHost) this.runAction(action);
          },
          onPlacement: placement => {
            if (this.host === launchedHost) this.updatePlacement(placement);
          },
          onStatus: status => {
            if (this.host === launchedHost) this.reportStatus(status);
          },
          onError: error => {
            if (this.host === launchedHost) {
              logger.warn('[WindowsTaskbarLyrics] C# taskbar host error:', error);
            }
          },
          onExit: (code, signal) => {
            if (this.host !== launchedHost) return;
            this.host = null;
            this.lastStatusKey = '';
            if (this.enabled && this.state?.trackId) {
              logger.warn('[WindowsTaskbarLyrics] C# taskbar host exited:', {
                code,
                signal,
              });
              this.scheduleRestart();
            }
          },
          onStderr: line => {
            if (this.host === launchedHost) {
              logger.warn('[WindowsTaskbarLyrics:host]', line);
            }
          },
        },
      });
      this.host = launchedHost;
      return launchedHost;
    } catch (error) {
      logger.error('[WindowsTaskbarLyrics] Failed to launch C# taskbar host:', error);
      this.scheduleRestart();
      return null;
    }
  }

  private renderState(): void {
    const state = this.state;
    const host = this.host;
    if (!state?.trackId || !host || this.sessionLocked) return;

    if (state.coverUrl !== this.lastCoverUrl) {
      this.lastCoverUrl = state.coverUrl;
      this.lastArtworkSource = this.dependencies.resolveArtworkSource(state.coverUrl);
    }

    const presentation: WindowsTaskbarHostState = {
      artworkSource: this.lastArtworkSource,
      title: state.title,
      artist: state.artist,
      line: state.line,
      nextLine: state.nextLine,
      lineCursor: finiteIndex(state.lineCursor),
      lineProgress: finiteIndex(state.lineProgress),
      isPlaying: state.isPlaying,
      placementMode: this.placement.mode,
      manualPosition: this.placement.position,
    };
    try {
      host.update(presentation);
    } catch (error) {
      logger.warn('[WindowsTaskbarLyrics] Failed to update C# taskbar host:', error);
    }
  }

  private setHostVisible(visible: boolean): void {
    if (!this.host) return;
    try {
      this.host.setVisible(visible);
    } catch (error) {
      logger.warn('[WindowsTaskbarLyrics] Failed to change host visibility:', error);
    }
  }

  private reportStatus(status: WindowsTaskbarHostStatus): void {
    const key = JSON.stringify(status);
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    if (status.attached) {
      logger.info('[WindowsTaskbarLyrics] WPF surface attached to Explorer taskbar:', status);
    } else {
      logger.warn('[WindowsTaskbarLyrics] WPF taskbar attachment deferred:', status.reason);
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

  private updatePlacement(placement: WindowsTaskbarHostPlacement): void {
    this.placement = placement.mode === 'manual'
      ? { mode: 'manual', position: placement.position }
      : { ...AUTO_PLACEMENT };
    try {
      if (!this.dependencies.savePlacement(this.placement)) {
        logger.warn('[WindowsTaskbarLyrics] Failed to persist taskbar placement.');
      }
    } catch (error) {
      logger.warn('[WindowsTaskbarLyrics] Failed to persist taskbar placement:', error);
    }
    this.renderState();
  }

  private scheduleRestart(): void {
    if (!this.enabled || !this.state?.trackId || this.restartTimer) return;
    const delay = Math.min(
      RESTART_BASE_DELAY_MS * (2 ** Math.min(this.restartAttempt, 6)),
      RESTART_MAX_DELAY_MS,
    );
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.enabled || !this.state?.trackId || this.sessionLocked) return;
      this.ensureHost();
      this.renderState();
    }, delay);
    this.restartTimer.unref();
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }
}

export const windowsTaskbarLyricsService = new WindowsTaskbarLyricsService();
