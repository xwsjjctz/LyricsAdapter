import fs from 'node:fs';
import path from 'node:path';
import { app, shell, type ShortcutDetails } from 'electron';
import { APP } from '../../src/constants/config';

const APP_SHORTCUT_NAME = `${APP.NAME}.lnk`;
const LEGACY_DEVELOPMENT_SHORTCUT_NAME = 'Electron.lnk';

export interface WindowsShellIdentityDependencies {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  programsDirectory: string;
  executablePath: string;
  exists: (filePath: string) => boolean;
  readShortcut: (filePath: string) => ShortcutDetails;
  writeShortcut: (
    filePath: string,
    operation: 'update',
    details: ShortcutDetails,
  ) => boolean;
  removeFile: (filePath: string) => void;
}

export interface WindowsShellIdentityRepairResult {
  appShortcutUpdated: boolean;
  staleDevelopmentShortcutRemoved: boolean;
  reason:
    | 'not-windows'
    | 'not-packaged'
    | 'app-shortcut-missing'
    | 'different-installation'
    | 'app-shortcut-update-failed'
    | 'ready';
}

function normalizeWindowsPath(filePath: string): string {
  return path.win32.normalize(filePath).toLocaleLowerCase('en-US');
}

function isLegacyDevelopmentShortcut(details: ShortcutDetails): boolean {
  const target = normalizeWindowsPath(details.target);
  return details.appUserModelId === APP.APP_ID
    && path.win32.basename(target) === 'electron.exe'
    && target.includes('\\node_modules\\electron\\dist\\');
}

function defaultDependencies(): WindowsShellIdentityDependencies {
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    programsDirectory: path.win32.join(
      app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
    ),
    executablePath: process.execPath,
    exists: filePath => fs.existsSync(filePath),
    readShortcut: filePath => shell.readShortcutLink(filePath),
    writeShortcut: (filePath, operation, details) => (
      shell.writeShortcutLink(filePath, operation, details)
    ),
    removeFile: filePath => fs.unlinkSync(filePath),
  };
}

/**
 * Repairs the one historical development shortcut that could claim the
 * production AppUserModelID and make Windows render electron.exe's icon for the
 * installed player. The migration only runs when the standard LyricsAdapter
 * shortcut targets this exact executable, so unpacked builds cannot modify the
 * user's installed application shortcuts.
 */
export function repairWindowsShellIdentity(
  dependencies: WindowsShellIdentityDependencies = defaultDependencies(),
): WindowsShellIdentityRepairResult {
  if (dependencies.platform !== 'win32') {
    return {
      appShortcutUpdated: false,
      staleDevelopmentShortcutRemoved: false,
      reason: 'not-windows',
    };
  }
  if (!dependencies.isPackaged) {
    return {
      appShortcutUpdated: false,
      staleDevelopmentShortcutRemoved: false,
      reason: 'not-packaged',
    };
  }

  const appShortcutPath = path.win32.join(
    dependencies.programsDirectory,
    APP_SHORTCUT_NAME,
  );
  if (!dependencies.exists(appShortcutPath)) {
    return {
      appShortcutUpdated: false,
      staleDevelopmentShortcutRemoved: false,
      reason: 'app-shortcut-missing',
    };
  }

  const appShortcut = dependencies.readShortcut(appShortcutPath);
  if (
    normalizeWindowsPath(appShortcut.target)
    !== normalizeWindowsPath(dependencies.executablePath)
  ) {
    return {
      appShortcutUpdated: false,
      staleDevelopmentShortcutRemoved: false,
      reason: 'different-installation',
    };
  }

  const executableDirectory = path.win32.dirname(dependencies.executablePath);
  const shortcutNeedsUpdate = appShortcut.appUserModelId !== APP.APP_ID
    || normalizeWindowsPath(appShortcut.icon ?? '')
      !== normalizeWindowsPath(dependencies.executablePath)
    || appShortcut.iconIndex !== 0
    || normalizeWindowsPath(appShortcut.cwd ?? '')
      !== normalizeWindowsPath(executableDirectory);
  const appShortcutUpdated = shortcutNeedsUpdate
    ? dependencies.writeShortcut(
      appShortcutPath,
      'update',
      {
        ...appShortcut,
        target: dependencies.executablePath,
        cwd: executableDirectory,
        icon: dependencies.executablePath,
        iconIndex: 0,
        appUserModelId: APP.APP_ID,
      },
    )
    : false;
  if (shortcutNeedsUpdate && !appShortcutUpdated) {
    return {
      appShortcutUpdated: false,
      staleDevelopmentShortcutRemoved: false,
      reason: 'app-shortcut-update-failed',
    };
  }

  const developmentShortcutPath = path.win32.join(
    dependencies.programsDirectory,
    LEGACY_DEVELOPMENT_SHORTCUT_NAME,
  );
  let staleDevelopmentShortcutRemoved = false;
  if (dependencies.exists(developmentShortcutPath)) {
    const developmentShortcut = dependencies.readShortcut(developmentShortcutPath);
    if (isLegacyDevelopmentShortcut(developmentShortcut)) {
      dependencies.removeFile(developmentShortcutPath);
      staleDevelopmentShortcutRemoved = true;
    }
  }

  return {
    appShortcutUpdated,
    staleDevelopmentShortcutRemoved,
    reason: 'ready',
  };
}
