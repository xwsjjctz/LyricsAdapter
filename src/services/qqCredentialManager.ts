import { logger } from './logger';
import { appStorage } from './appStorage';
import { getDesktopAPIAsync } from './desktopAdapter';
import { cookieManager, syncOnlineCookiesToMain } from './cookieManager';
import { credentialExpiresAt, isQQCredential, type QQCredential } from '../shared/qqCredential';

/**
 * Keeps the QQ Music login alive without another QR scan.
 *
 * The QR login returns a refresh key/token next to the short-lived musickey.
 * This manager persists that credential (encrypted with the other QQ
 * secrets) and exchanges it for a new musickey:
 *   - on startup and on an hourly check when the key is close to expiring;
 *   - when an API call reports the cookie as expired (`refresh`).
 * A refreshed musickey is written back into the QQ cookie store and pushed to
 * the main-process stream proxy.
 */

export const QQ_CREDENTIAL_STORAGE_KEY = 'qq_music_credential';

/** Refresh when the musickey has less than this left. */
const REFRESH_AHEAD_MS = 24 * 60 * 60 * 1000;
/** Refresh age when the upstream did not report a lifetime. */
const UNKNOWN_LIFETIME_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Minimum spacing between refresh attempts so a dead token is not hammered. */
const MIN_ATTEMPT_INTERVAL_MS = 10 * 60 * 1000;

class QQCredentialManager {
  private inFlight: Promise<boolean> | null = null;
  private lastAttemptAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  async getCredential(): Promise<QQCredential | null> {
    await appStorage.init();
    const raw = appStorage.getItem(QQ_CREDENTIAL_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isQQCredential(parsed) ? parsed : null;
    } catch {
      logger.warn('[QQCredential] Stored credential is not valid JSON; ignoring');
      return null;
    }
  }

  async setCredential(credential: QQCredential): Promise<void> {
    await appStorage.setItem(QQ_CREDENTIAL_STORAGE_KEY, JSON.stringify(credential));
  }

  async clearCredential(): Promise<void> {
    await appStorage.setItem(QQ_CREDENTIAL_STORAGE_KEY, '');
  }

  needsRefresh(credential: QQCredential, now: number = Date.now()): boolean {
    const expiresAt = credentialExpiresAt(credential);
    if (expiresAt === null) {
      return now - credential.musickeyCreateTime * 1000 >= UNKNOWN_LIFETIME_REFRESH_AGE_MS;
    }
    return expiresAt - now <= REFRESH_AHEAD_MS;
  }

  /** Refresh only when the stored musickey is close to expiring. */
  async refreshIfNeeded(): Promise<boolean> {
    const credential = await this.getCredential();
    if (!credential || !this.needsRefresh(credential)) return false;
    return this.refresh();
  }

  /** Single-flight refresh, rate-limited by `MIN_ATTEMPT_INTERVAL_MS`. */
  refresh(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    if (Date.now() - this.lastAttemptAt < MIN_ATTEMPT_INTERVAL_MS) return Promise.resolve(false);
    this.lastAttemptAt = Date.now();
    this.inFlight = this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(): Promise<boolean> {
    const credential = await this.getCredential();
    if (!credential) return false;
    const api = await getDesktopAPIAsync();
    if (!api?.qqLoginRefresh) return false;

    await cookieManager.ensureLoaded();
    try {
      const result = await api.qqLoginRefresh(credential, cookieManager.getCookie());
      if (!result.success || !result.credential || !result.cookie) {
        logger.warn('[QQCredential] Refresh rejected:', result.error);
        return false;
      }
      await this.setCredential(result.credential);
      await cookieManager.setCookie(result.cookie);
      await syncOnlineCookiesToMain('qq');
      logger.info('[QQCredential] musickey refreshed');
      return true;
    } catch (error) {
      logger.warn('[QQCredential] Refresh failed:', error);
      return false;
    }
  }

  /** Check now and then hourly. Idempotent. */
  start(): void {
    if (this.timer) return;
    void this.refreshIfNeeded();
    this.timer = setInterval(() => { void this.refreshIfNeeded(); }, CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Test hook: forget rate-limit state. */
  resetForTests(): void {
    this.stop();
    this.inFlight = null;
    this.lastAttemptAt = 0;
  }
}

export const qqCredentialManager = new QQCredentialManager();
