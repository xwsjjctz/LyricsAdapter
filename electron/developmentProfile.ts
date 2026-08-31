import fs from 'node:fs';
import path from 'node:path';
import type { App } from 'electron';

export const DEVELOPMENT_USER_DATA_DIRECTORY = 'lyrics-adapter-dev';

type DevelopmentProfileApp = Pick<
  App,
  'commandLine' | 'getPath' | 'isPackaged' | 'setPath'
>;

/**
 * Keeps Electron's replaceable Chromium profile and process lock separate from
 * an installed LyricsAdapter instance. User-owned settings and library state
 * remain in ~/.la and are therefore still shared with development builds.
 */
export function configureDevelopmentProfile(
  electronApp: DevelopmentProfileApp,
  ensureDirectory: (directory: string) => void = directory => {
    fs.mkdirSync(directory, { recursive: true });
  },
): string | null {
  if (
    electronApp.isPackaged
    || electronApp.commandLine.hasSwitch('user-data-dir')
  ) {
    return null;
  }

  const developmentUserDataPath = path.join(
    electronApp.getPath('appData'),
    DEVELOPMENT_USER_DATA_DIRECTORY,
  );
  ensureDirectory(developmentUserDataPath);
  electronApp.setPath('userData', developmentUserDataPath);
  return developmentUserDataPath;
}
