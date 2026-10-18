import fs from 'node:fs';
import path from 'node:path';
import type { App } from 'electron';
import { logger } from './logger';

export const DEVELOPMENT_USER_DATA_DIRECTORY = 'lyrics-adapter-dev';
const LOCAL_STATE_FILE = 'Local State';

type DevelopmentProfileApp = Pick<
  App,
  'commandLine' | 'getPath' | 'isPackaged' | 'setPath'
>;
type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function readLocalState(file: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isJsonObject(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Windows safeStorage keeps its key in the profile's Local State, wrapped with DPAPI for
 * the current Windows user. Credentials in the shared ~/.la are encrypted with the
 * installed profile's key, so the development profile adopts it before Chromium reads its
 * Local State. Without this neither build can read the credentials the other one saved,
 * and each refuses to start. Returns whether the development profile's key was replaced.
 */
export function adoptInstalledSafeStorageKey(installedUserDataPath: string, developmentUserDataPath: string): boolean {
  const installed = readLocalState(path.join(installedUserDataPath, LOCAL_STATE_FILE))?.['os_crypt'];
  const key = isJsonObject(installed) ? installed['encrypted_key'] : undefined;
  if (typeof key !== 'string' || !key) return false;
  const file = path.join(developmentUserDataPath, LOCAL_STATE_FILE);
  // An unreadable development Local State is replaceable Chromium data; start a new one.
  const state = readLocalState(file) ?? {};
  const osCrypt = isJsonObject(state['os_crypt']) ? state['os_crypt'] : {};
  if (osCrypt['encrypted_key'] === key) return false;
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...state, os_crypt: { ...osCrypt, encrypted_key: key } }));
  fs.renameSync(temporary, file);
  return true;
}

/**
 * Keeps Electron's replaceable Chromium profile and process lock separate from
 * an installed LyricsAdapter instance. User-owned settings and library state
 * remain in ~/.la and are therefore still shared with development builds; on
 * Windows the profile also shares the installed safeStorage key so credentials
 * in ~/.la stay readable by both.
 */
export function configureDevelopmentProfile(
  electronApp: DevelopmentProfileApp,
  ensureDirectory: (directory: string) => void = directory => {
    fs.mkdirSync(directory, { recursive: true });
  },
  shareSafeStorageKey: ((installedUserDataPath: string, developmentUserDataPath: string) => boolean) | null =
    process.platform === 'win32' ? adoptInstalledSafeStorageKey : null,
): string | null {
  if (
    electronApp.isPackaged
    || electronApp.commandLine.hasSwitch('user-data-dir')
  ) {
    return null;
  }

  // Before the override, userData is the installed build's profile (same app name).
  const installedUserDataPath = electronApp.getPath('userData');
  const developmentUserDataPath = path.join(
    electronApp.getPath('appData'),
    DEVELOPMENT_USER_DATA_DIRECTORY,
  );
  ensureDirectory(developmentUserDataPath);
  if (shareSafeStorageKey) {
    try {
      if (shareSafeStorageKey(installedUserDataPath, developmentUserDataPath)) {
        logger.info('[DevelopmentProfile] Adopted the installed profile\'s safeStorage key');
      }
    } catch (error) {
      logger.warn('[DevelopmentProfile] Could not share the installed safeStorage key', error);
    }
  }
  electronApp.setPath('userData', developmentUserDataPath);
  return developmentUserDataPath;
}
