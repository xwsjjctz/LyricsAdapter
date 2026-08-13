/** Compatibility façade over the SQLite user-state repository. */
import { logger } from '../logger';
import { userStateRepository } from './userStateRepository';

export class SettingsStore {
  initialize(): void {
    userStateRepository.initialize();
  }

  getDirectoryPath(): string {
    return userStateRepository.directoryPath;
  }

  get(key: string): string | undefined {
    return userStateRepository.getSetting(key);
  }

  getAll(): Record<string, string> {
    return userStateRepository.getAllSettings();
  }

  set(key: string, value: string): boolean {
    return this.persist(() => userStateRepository.setSetting(key, value));
  }

  setMany(entries: Record<string, string>): boolean {
    return this.persist(() => userStateRepository.setManySettings(entries));
  }

  delete(key: string): boolean {
    return this.persist(() => userStateRepository.deleteSetting(key));
  }

  replaceAll(entries: Record<string, string>): boolean {
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
