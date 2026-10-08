/** Compatibility façade over the SQLite user-state repository. */
import { logger } from '../logger';
import { isSensitiveSettingKey } from '../../src/shared/persistencePolicy';
import { userStateRepository } from './userStateRepository';

export class SettingsStore {
  // Secrets the repository refused to store, typically because safeStorage is
  // unavailable. They serve the running session and are never written to disk.
  private readonly sessionSecrets = new Map<string, string>();

  initialize(): void {
    userStateRepository.initialize();
  }

  getDirectoryPath(): string {
    return userStateRepository.directoryPath;
  }

  get(key: string): string | undefined {
    return this.sessionSecrets.get(key) ?? userStateRepository.getSetting(key);
  }

  getAll(): Record<string, string> {
    return { ...userStateRepository.getAllSettings(), ...Object.fromEntries(this.sessionSecrets) };
  }

  set(key: string, value: string): boolean {
    return this.setMany({ [key]: value }, () => userStateRepository.setSetting(key, value));
  }

  setMany(
    entries: Record<string, string>,
    write: () => void = () => userStateRepository.setManySettings(entries),
  ): boolean {
    if (this.persist(write)) {
      for (const key of Object.keys(entries)) this.sessionSecrets.delete(key);
      return true;
    }
    const secrets = Object.entries(entries).filter(([key]) => isSensitiveSettingKey(key));
    if (!secrets.length) return false;
    for (const [key, value] of secrets) this.sessionSecrets.set(key, value);
    const ordinary = Object.entries(entries).filter(([key]) => !isSensitiveSettingKey(key));
    if (ordinary.length) this.persist(() => userStateRepository.setManySettings(Object.fromEntries(ordinary)));
    return false;
  }

  delete(key: string): boolean {
    this.sessionSecrets.delete(key);
    return this.persist(() => userStateRepository.deleteSetting(key));
  }

  replaceAll(entries: Record<string, string>): boolean {
    this.sessionSecrets.clear();
    return this.persist(() => userStateRepository.replaceAllSettings(entries));
  }

  private persist(operation: () => void): boolean {
    try {
      operation();
      return true;
    } catch (error) {
      logger.error('[SettingsStore] Failed to persist setting:', error);
      return false;
    }
  }
}

export const settingsStore = new SettingsStore();
