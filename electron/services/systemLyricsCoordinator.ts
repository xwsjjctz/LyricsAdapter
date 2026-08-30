import type { SystemLyricsAction, SystemLyricsState } from '../../src/types/systemLyrics';
import { menuBarLyricsService } from './menuBarLyricsService';
import { windowsTaskbarLyricsService } from './windowsTaskbarLyricsService';

export interface SystemLyricsPlatformService {
  start(onAction: (action: SystemLyricsAction) => void): boolean;
  update(state: SystemLyricsState): void | Promise<void>;
  stop(): void;
}

interface SystemLyricsCoordinatorDependencies {
  platform: NodeJS.Platform;
  macOS: SystemLyricsPlatformService;
  windows: SystemLyricsPlatformService;
}

/** Selects one platform surface and keeps its lifecycle outside playback code. */
export class SystemLyricsCoordinator {
  private readonly platform: NodeJS.Platform;
  private readonly service: SystemLyricsPlatformService | null;
  private failedStartTrackId: string | null = null;
  private started = false;

  constructor(
    private readonly onAction: (action: SystemLyricsAction) => void,
    dependencies: Partial<SystemLyricsCoordinatorDependencies> = {},
  ) {
    const resolved: SystemLyricsCoordinatorDependencies = {
      platform: process.platform,
      macOS: menuBarLyricsService,
      windows: windowsTaskbarLyricsService,
      ...dependencies,
    };
    this.platform = resolved.platform;
    this.service = resolved.platform === 'darwin'
      ? resolved.macOS
      : resolved.platform === 'win32' ? resolved.windows : null;
  }

  /**
   * Creates the macOS status item as soon as Electron is ready. This makes the
   * native icon visible before playback and keeps its position stable while the
   * renderer starts or hot-reloads. Windows remains lazy because it launches a
   * separate taskbar helper that is only useful once a track exists.
   */
  initialize(): boolean {
    if (this.platform !== 'darwin' || !this.service) return false;
    if (this.started) return true;
    return this.startService(null);
  }

  async update(state: SystemLyricsState): Promise<void> {
    if (!this.service) return;

    // Windows and any failed macOS eager-start retry remain lazy here: an empty
    // renderer snapshot must not launch a helper or trigger another start.
    if (!this.started) {
      if (!state.trackId) {
        this.failedStartTrackId = null;
        return;
      }
      // A missing platform surface must not be retried for every lyric line.
      // A new track (or an explicit stop) opens one fresh start attempt.
      if (state.trackId === this.failedStartTrackId) return;

      if (!this.startService(state.trackId)) return;
    }

    await this.service.update(state);
  }

  private startService(failedStartTrackId: string | null): boolean {
    if (!this.service) return false;

    try {
      this.started = this.service.start(action => this.onAction(action));
    } catch (error) {
      this.failedStartTrackId = failedStartTrackId;
      this.service.stop();
      throw error;
    }

    if (!this.started) {
      this.failedStartTrackId = failedStartTrackId;
      this.service.stop();
      return false;
    }

    this.failedStartTrackId = null;
    return true;
  }

  stop(): void {
    try {
      this.service?.stop();
    } finally {
      this.started = false;
      this.failedStartTrackId = null;
    }
  }
}
