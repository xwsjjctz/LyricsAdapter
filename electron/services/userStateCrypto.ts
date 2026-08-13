import { safeStorage } from 'electron';
import { isSensitiveSettingKey } from '../../src/shared/persistencePolicy';

export const ENCRYPTED_VALUE_PREFIX = 'enc:';

export interface UserStateCrypto {
  encodeSetting(key: string, value: string): string;
  decodeSetting(key: string, value: string): string;
}

export class SafeStorageUserStateCrypto implements UserStateCrypto {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  encodeSetting(key: string, value: string): string {
    // Values entering the runtime API are plaintext even when a user-provided
    // cookie/password happens to start with "enc:". Legacy stored envelopes are
    // decoded explicitly by the migration layer before they reach this method.
    if (!isSensitiveSettingKey(key)) return value;
    if (!this.isAvailable()) {
      throw new Error('safeStorage is unavailable; refusing to persist a sensitive setting as plaintext');
    }
    return `${ENCRYPTED_VALUE_PREFIX}${safeStorage.encryptString(value).toString('hex')}`;
  }

  decodeSetting(key: string, value: string): string {
    if (!isSensitiveSettingKey(key) || !value.startsWith(ENCRYPTED_VALUE_PREFIX)) return value;
    if (!this.isAvailable()) {
      throw new Error('safeStorage is unavailable; cannot decrypt a sensitive setting');
    }
    const payload = value.slice(ENCRYPTED_VALUE_PREFIX.length);
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(payload)) {
      throw new Error('Invalid encrypted setting envelope');
    }
    return safeStorage.decryptString(Buffer.from(payload, 'hex'));
  }

  private isAvailable(): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      // Linux's basic_text backend uses a hard-coded password and Electron
      // explicitly reports the data as unprotected. Treat it as unavailable so
      // credentials never acquire a misleading encrypted envelope.
      return this.platform !== 'linux'
        || safeStorage.getSelectedStorageBackend() !== 'basic_text';
    } catch {
      return false;
    }
  }
}

export const userStateCrypto = new SafeStorageUserStateCrypto();
